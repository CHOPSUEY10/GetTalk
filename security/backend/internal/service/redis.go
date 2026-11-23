package service

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gettalk/security/backend/internal/config"
)

// ErrRedisUnavailable is a safe, credential-free error returned when Redis operations fail.
var ErrRedisUnavailable = errors.New("redis state store temporarily unavailable")

// RedisClient defines the Upstash Redis / TCP Redis operations required for SIEM alert cooldowns and Backend Kill Switch.
type RedisClient interface {
	SetNX(ctx context.Context, key string, value string, ttl time.Duration) (bool, error)
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value string, ttl time.Duration) error
}

// NewRedisClient creates an Upstash REST Redis client when configured, a standard TCP/TLS Redis client
// when REDIS_URL (e.g. from backend/.env.production) is configured, or falls back to an in-memory Redis store.
func NewRedisClient(cfg config.RedisConfig) RedisClient {
	if strings.TrimSpace(cfg.RestURL) != "" && strings.TrimSpace(cfg.RestToken) != "" {
		return NewUpstashRedisClient(cfg.RestURL, cfg.RestToken, nil)
	}
	if strings.TrimSpace(cfg.URL) != "" {
		tcpClient, err := NewTCPRedisClient(cfg.URL)
		if err == nil {
			return tcpClient
		}
	}
	return NewMemoryRedisClient()
}

// UpstashRedisClient communicates with Upstash Redis over its REST API without exposing credentials in errors.
type UpstashRedisClient struct {
	restURL    string
	restToken  string
	httpClient *http.Client
}

// NewUpstashRedisClient initializes a new Upstash REST API Redis client.
func NewUpstashRedisClient(restURL, restToken string, httpClient *http.Client) *UpstashRedisClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	return &UpstashRedisClient{
		restURL:    strings.TrimRight(strings.TrimSpace(restURL), "/"),
		restToken:  strings.TrimSpace(restToken),
		httpClient: httpClient,
	}
}

type upstashResponse struct {
	Result interface{} `json:"result"`
	Error  string      `json:"error"`
}

func (u *UpstashRedisClient) execCommand(ctx context.Context, cmd []interface{}) (*upstashResponse, error) {
	if u.restURL == "" || u.restToken == "" {
		return nil, ErrRedisUnavailable
	}
	bodyBytes, err := json.Marshal(cmd)
	if err != nil {
		return nil, ErrRedisUnavailable
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.restURL, bytes.NewReader(bodyBytes))
	if err != nil {
		// Never leak URL or token in error messages
		return nil, ErrRedisUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+u.restToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return nil, ErrRedisUnavailable
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, ErrRedisUnavailable
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrRedisUnavailable
	}

	var parsed upstashResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, ErrRedisUnavailable
	}
	if parsed.Error != "" {
		return nil, ErrRedisUnavailable
	}
	return &parsed, nil
}

// SetNX sets key to value if key does not exist, with the specified TTL.
func (u *UpstashRedisClient) SetNX(ctx context.Context, key string, value string, ttl time.Duration) (bool, error) {
	cmd := []interface{}{"SET", key, value, "NX"}
	if ttl > 0 {
		sec := int(ttl.Seconds())
		if sec < 1 {
			sec = 1
		}
		cmd = append(cmd, "EX", strconv.Itoa(sec))
	}
	res, err := u.execCommand(ctx, cmd)
	if err != nil {
		return false, err
	}
	if res.Result == nil {
		return false, nil
	}
	if s, ok := res.Result.(string); ok {
		return strings.EqualFold(s, "OK"), nil
	}
	return false, nil
}

// Get retrieves the string value of key, or returns "" if the key does not exist.
func (u *UpstashRedisClient) Get(ctx context.Context, key string) (string, error) {
	res, err := u.execCommand(ctx, []interface{}{"GET", key})
	if err != nil {
		return "", err
	}
	if res.Result == nil {
		return "", nil
	}
	switch v := res.Result.(type) {
	case string:
		return v, nil
	case bool:
		if v {
			return "true", nil
		}
		return "false", nil
	default:
		return fmt.Sprintf("%v", v), nil
	}
}

// Set stores key and value in Upstash Redis with an optional TTL (0 means no expiration).
func (u *UpstashRedisClient) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	cmd := []interface{}{"SET", key, value}
	if ttl > 0 {
		sec := int(ttl.Seconds())
		if sec < 1 {
			sec = 1
		}
		cmd = append(cmd, "EX", strconv.Itoa(sec))
	}
	_, err := u.execCommand(ctx, cmd)
	return err
}

// TCPRedisClient communicates with a standard Redis server over RESP TCP/TLS (e.g., REDIS_URL=redis://127.0.0.1:6379)
// so local development shares state seamlessly between the Go SIEM backend and the Node.js Chat Server.
type TCPRedisClient struct {
	addr     string
	username string
	password string
	db       int
	useTLS   bool
	timeout  time.Duration
}

// NewTCPRedisClient parses a redis:// or rediss:// URL into a TCPRedisClient without exposing credentials in errors.
func NewTCPRedisClient(rawURL string) (*TCPRedisClient, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil, ErrRedisUnavailable
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "redis://" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil || u.Host == "" {
		return nil, ErrRedisUnavailable
	}
	addr := u.Host
	if !strings.Contains(addr, ":") {
		addr += ":6379"
	}
	var username, password string
	if u.User != nil {
		username = u.User.Username()
		password, _ = u.User.Password()
	}
	db := 0
	if path := strings.TrimPrefix(u.Path, "/"); path != "" {
		if parsedDB, err := strconv.Atoi(path); err == nil && parsedDB >= 0 {
			db = parsedDB
		}
	}
	return &TCPRedisClient{
		addr:     addr,
		username: username,
		password: password,
		db:       db,
		useTLS:   strings.EqualFold(u.Scheme, "rediss"),
		timeout:  5 * time.Second,
	}, nil
}

func (c *TCPRedisClient) execRESP(ctx context.Context, args ...string) (string, bool, error) {
	dialer := &net.Dialer{Timeout: c.timeout}
	var conn net.Conn
	var err error
	if c.useTLS {
		host, _, _ := net.SplitHostPort(c.addr)
		conn, err = tls.DialWithDialer(dialer, "tcp", c.addr, &tls.Config{
			ServerName: host,
			MinVersion: tls.VersionTLS12,
		})
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", c.addr)
	}
	if err != nil {
		return "", false, ErrRedisUnavailable
	}
	defer conn.Close()

	deadline := time.Now().Add(c.timeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetDeadline(deadline)

	reader := bufio.NewReader(conn)

	sendAndRead := func(cmdArgs ...string) (string, bool, error) {
		var buf bytes.Buffer
		fmt.Fprintf(&buf, "*%d\r\n", len(cmdArgs))
		for _, a := range cmdArgs {
			fmt.Fprintf(&buf, "$%d\r\n%s\r\n", len(a), a)
		}
		if _, err := conn.Write(buf.Bytes()); err != nil {
			return "", false, ErrRedisUnavailable
		}
		line, err := reader.ReadString('\n')
		if err != nil {
			return "", false, ErrRedisUnavailable
		}
		line = strings.TrimRight(line, "\r\n")
		if len(line) == 0 {
			return "", false, ErrRedisUnavailable
		}
		switch line[0] {
		case '+':
			return line[1:], false, nil
		case '-':
			return "", false, ErrRedisUnavailable
		case ':':
			return line[1:], false, nil
		case '$':
			n, err := strconv.Atoi(line[1:])
			if err != nil {
				return "", false, ErrRedisUnavailable
			}
			if n < 0 {
				return "", true, nil
			}
			payload := make([]byte, n+2)
			if _, err := io.ReadFull(reader, payload); err != nil {
				return "", false, ErrRedisUnavailable
			}
			return string(payload[:n]), false, nil
		default:
			return "", false, ErrRedisUnavailable
		}
	}

	if c.password != "" {
		var authErr error
		if c.username != "" {
			_, _, authErr = sendAndRead("AUTH", c.username, c.password)
			if authErr != nil {
				_, _, authErr = sendAndRead("AUTH", c.password)
			}
		} else {
			_, _, authErr = sendAndRead("AUTH", c.password)
		}
		if authErr != nil {
			return "", false, ErrRedisUnavailable
		}
	}
	if c.db > 0 {
		if _, _, err := sendAndRead("SELECT", strconv.Itoa(c.db)); err != nil {
			return "", false, ErrRedisUnavailable
		}
	}

	return sendAndRead(args...)
}

// Ping verifies connectivity to the TCP Redis server.
func (c *TCPRedisClient) Ping(ctx context.Context) error {
	_, _, err := c.execRESP(ctx, "PING")
	return err
}

// SetNX sets key to value if key does not exist, with the specified TTL.
func (c *TCPRedisClient) SetNX(ctx context.Context, key string, value string, ttl time.Duration) (bool, error) {
	cmd := []string{"SET", key, value, "NX"}
	if ttl > 0 {
		sec := int(ttl.Seconds())
		if sec < 1 {
			sec = 1
		}
		cmd = append(cmd, "EX", strconv.Itoa(sec))
	}
	res, isNil, err := c.execRESP(ctx, cmd...)
	if err != nil {
		return false, err
	}
	if isNil {
		return false, nil
	}
	return strings.EqualFold(res, "OK"), nil
}

// Get retrieves the string value of key, or returns "" if the key does not exist.
func (c *TCPRedisClient) Get(ctx context.Context, key string) (string, error) {
	res, isNil, err := c.execRESP(ctx, "GET", key)
	if err != nil {
		return "", err
	}
	if isNil {
		return "", nil
	}
	return res, nil
}

// Set stores key and value in TCP Redis with an optional TTL (0 means no expiration).
func (c *TCPRedisClient) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	cmd := []string{"SET", key, value}
	if ttl > 0 {
		sec := int(ttl.Seconds())
		if sec < 1 {
			sec = 1
		}
		cmd = append(cmd, "EX", strconv.Itoa(sec))
	}
	_, _, err := c.execRESP(ctx, cmd...)
	return err
}

type memEntry struct {
	value     string
	expiresAt time.Time
}

// MemoryRedisClient is a thread-safe in-memory implementation of RedisClient with TTL support.
type MemoryRedisClient struct {
	mu    sync.RWMutex
	store map[string]memEntry
}

// NewMemoryRedisClient creates a new in-memory RedisClient.
func NewMemoryRedisClient() *MemoryRedisClient {
	return &MemoryRedisClient{
		store: make(map[string]memEntry),
	}
}

func (m *MemoryRedisClient) SetNX(_ context.Context, key string, value string, ttl time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if existing, ok := m.store[key]; ok {
		if existing.expiresAt.IsZero() || now.Before(existing.expiresAt) {
			return false, nil
		}
	}

	var exp time.Time
	if ttl > 0 {
		exp = now.Add(ttl)
	}
	m.store[key] = memEntry{
		value:     value,
		expiresAt: exp,
	}
	return true, nil
}

func (m *MemoryRedisClient) Get(_ context.Context, key string) (string, error) {
	m.mu.RLock()
	existing, ok := m.store[key]
	m.mu.RUnlock()
	if !ok {
		return "", nil
	}
	if !existing.expiresAt.IsZero() && time.Now().UTC().After(existing.expiresAt) {
		m.mu.Lock()
		delete(m.store, key)
		m.mu.Unlock()
		return "", nil
	}
	return existing.value, nil
}

func (m *MemoryRedisClient) Set(_ context.Context, key string, value string, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var exp time.Time
	if ttl > 0 {
		exp = time.Now().UTC().Add(ttl)
	}
	m.store[key] = memEntry{
		value:     value,
		expiresAt: exp,
	}
	return nil
}
