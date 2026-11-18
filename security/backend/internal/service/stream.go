package service

import (
	"sync"
	"time"

	"github.com/gettalk/security/backend/internal/models"
)

// SSEBroker manages Server-Sent Events (SSE) client subscriptions with bounded buffers.
type SSEBroker struct {
	mu      sync.RWMutex
	clients map[chan models.StreamMessage]struct{}
}

// NewSSEBroker creates a new SSE stream broker.
func NewSSEBroker() *SSEBroker {
	return &SSEBroker{
		clients: make(map[chan models.StreamMessage]struct{}),
	}
}

// Subscribe registers a new SSE client and returns a bounded channel and an unsubscribe function.
func (b *SSEBroker) Subscribe() (<-chan models.StreamMessage, func()) {
	ch := make(chan models.StreamMessage, 64)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()

	// Send initial connection confirmation message
	ch <- models.StreamMessage{
		Type:      "connected",
		Timestamp: time.Now().UTC(),
		Payload:   map[string]string{"status": "streaming"},
	}

	unsubscribe := func() {
		b.mu.Lock()
		if _, exists := b.clients[ch]; exists {
			delete(b.clients, ch)
			close(ch)
		}
		b.mu.Unlock()
	}

	return ch, unsubscribe
}

// Publish broadcasts a message to all active SSE subscribers without blocking slow clients.
func (b *SSEBroker) Publish(msg models.StreamMessage) {
	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now().UTC()
	}
	b.mu.RLock()
	defer b.mu.RUnlock()

	for ch := range b.clients {
		select {
		case ch <- msg:
		default:
			// Drop message for slow client to prevent backpressure buildup
		}
	}
}

// ClientCount returns the number of active SSE subscribers.
func (b *SSEBroker) ClientCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.clients)
}

