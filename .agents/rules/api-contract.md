---
trigger: model_decision
description: when writing code for processing request payload or processing response payload
---

# GetTalk API Contract

**Version:** 1.0\
**Status:** Draft for frontend/backend integration

## 1. Purpose

This document defines the HTTP API contract between the GetTalk frontend
and backend.

Core rules:

1.  The backend must never receive plaintext message content.
2.  The backend must never receive plaintext sensitive file content.
3.  Payloads contain only data required for the requested operation.
4.  Do not repeat data already available from authentication context or
    URL parameters.
5.  Secrets must never be returned to the frontend.
6.  Backend authorization is authoritative.
7.  API responses use explicit DTOs; do not serialize complete database
    entities.
8.  Message content is represented by client-generated ciphertext and
    the minimum required cryptographic metadata.

## 2. Base URL

Development backend:

``` text
http://localhost:3000
```

API prefix:

``` text
/api
```

Frontend must read the base URL from `VITE_API_URL`.

## 3. Authentication

Authenticated requests use the server-managed session and:

``` js
credentials: 'include'
```

Do not store session secrets in `localStorage`, `sessionStorage`, Svelte
stores, URLs, or request bodies.

Never return session secrets, password hashes, MFA secrets, or private
cryptographic keys.

## 4. Standard Error Response

``` json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

Never return stack traces, SQL errors, internal paths, secrets, or
session identifiers.

## 5. Authentication API

### Register

``` http
POST /api/auth/register
```

Request:

``` json
{
  "username": "john",
  "email": "john@example.com",
  "password": "client-supplied-password"
}
```

The password is accepted only for registration, must never be returned
or logged, and must be stored only as a secure password hash.

Response:

``` json
{
  "user": {
    "id": "usr_123",
    "username": "john"
  }
}
```

Never return the password, password hash, session secret, private key,
or unrelated database fields.

### Login

``` http
POST /api/auth/login
```

Request:

``` json
{
  "email": "john@example.com",
  "password": "client-supplied-password"
}
```

Successful response:

``` json
{
  "user": {
    "id": "usr_123",
    "username": "john"
  }
}
```

If MFA is required:

``` json
{
  "mfaRequired": true,
  "challengeId": "mfa_challenge_123"
}
```

`challengeId` must be an opaque short-lived reference and must not
contain the MFA secret.

### Logout

``` http
POST /api/auth/logout
```

No request body.

The session is identified from authentication context.

Response:

``` http
204 No Content
```

### Session

``` http
GET /api/auth/session
```

Authenticated response:

``` json
{
  "user": {
    "id": "usr_123",
    "username": "john"
  }
}
```

Unauthenticated:

``` http
401 Unauthorized
```

Do not return passwords, password hashes, session IDs/tokens, MFA
secrets, private keys, or unnecessary profile fields.

### MFA Verification

``` http
POST /api/auth/mfa/verify
```

Request:

``` json
{
  "challengeId": "mfa_challenge_123",
  "code": "123456"
}
```

Never log or return the MFA code.

## 6. User API

### Current User

``` http
GET /api/users/me
```

Response:

``` json
{
  "user": {
    "id": "usr_123",
    "username": "john"
  }
}
```

Return only fields explicitly required by the UI.

### Search Users

``` http
GET /api/users/search?q=john
```

Response:

``` json
{
  "users": [
    {
      "id": "usr_456",
      "username": "johnny"
    }
  ]
}
```

Do not expose passwords, password hashes, session data, private keys,
internal fields, or unnecessary contact information.

### Get User

``` http
GET /api/users/:userId
```

Response:

``` json
{
  "user": {
    "id": "usr_456",
    "username": "johnny"
  }
}
```

Do not return the complete database user record.

## 7. Friendship API

### List Friends

``` http
GET /api/friends
```

Response:

``` json
{
  "friends": [
    {
      "userId": "usr_456",
      "username": "alice"
    }
  ]
}
```

### List Friend Requests

``` http
GET /api/friends/requests
```

Response:

``` json
{
  "requests": [
    {
      "id": "fr_123",
      "fromUser": {
        "id": "usr_456",
        "username": "alice"
      },
      "createdAt": "2026-09-26T10:00:00Z"
    }
  ]
}
```

### Send Friend Request

``` http
POST /api/friends/requests
```

Request:

``` json
{
  "userId": "usr_456"
}
```

Do not send the authenticated user's ID; derive it from the session.

Response:

``` json
{
  "request": {
    "id": "fr_123",
    "userId": "usr_456",
    "status": "pending"
  }
}
```

### Accept

``` http
POST /api/friends/requests/:requestId/accept
```

No request body.

Response:

``` json
{
  "friend": {
    "userId": "usr_456",
    "username": "alice"
  }
}
```

### Reject

``` http
POST /api/friends/requests/:requestId/reject
```

No request body.

Response:

``` http
204 No Content
```

### Remove Friend

``` http
DELETE /api/friends/:userId
```

No request body.

Response:

``` http
204 No Content
```

## 8. Conversation API

### List Conversations

``` http
GET /api/conversations
```

Response:

``` json
{
  "conversations": [
    {
      "id": "conv_123",
      "type": "direct",
      "peer": {
        "id": "usr_456",
        "username": "alice"
      },
      "lastMessageAt": "2026-09-26T10:30:00Z"
    }
  ]
}
```

Do not embed the complete last-message object or plaintext content
merely for list rendering.

### Get Conversation

``` http
GET /api/conversations/:conversationId
```

Response:

``` json
{
  "conversation": {
    "id": "conv_123",
    "type": "direct",
    "peer": {
      "id": "usr_456",
      "username": "alice"
    }
  }
}
```

Backend must verify conversation membership.

### Create Direct Conversation

``` http
POST /api/conversations
```

Request:

``` json
{
  "userId": "usr_456"
}
```

Do not send the initiator ID; it comes from authentication context.

Response:

``` json
{
  "conversation": {
    "id": "conv_123",
    "type": "direct",
    "peer": {
      "id": "usr_456",
      "username": "alice"
    }
  }
}
```

The backend should reuse an existing direct conversation rather than
creating duplicates.

## 9. Message API

The backend must never receive plaintext message content.

### Message Payload

``` json
{
  "bodyCiphertext": "BASE64URL_CIPHERTEXT",
  "nonce": "BASE64URL_NONCE",
  "clientMessageId": "msg_client_123"
}
```

`clientMessageId` is optional and exists only for client-side
correlation/idempotency.

Forbidden:

``` json
{
  "body": "Hello Alice"
}
```

``` json
{
  "plaintext": "Hello Alice"
}
```

Do not send `senderId` when it can be derived from authentication
context.

Do not send `conversationId` when it is already in the URL.

### Send Message

``` http
POST /api/conversations/:conversationId/messages
```

Request:

``` json
{
  "bodyCiphertext": "BASE64URL_CIPHERTEXT",
  "nonce": "BASE64URL_NONCE",
  "clientMessageId": "msg_client_123"
}
```

Response:

``` json
{
  "message": {
    "id": "msg_123",
    "conversationId": "conv_123",
    "senderId": "usr_123",
    "bodyCiphertext": "BASE64URL_CIPHERTEXT",
    "nonce": "BASE64URL_NONCE",
    "createdAt": "2026-09-26T10:30:00Z"
  }
}
```

The server is authoritative for IDs and timestamps.

### Message History

``` http
GET /api/conversations/:conversationId/messages?limit=50&before=msg_100
```

Response:

``` json
{
  "messages": [
    {
      "id": "msg_123",
      "senderId": "usr_456",
      "bodyCiphertext": "BASE64URL_CIPHERTEXT",
      "nonce": "BASE64URL_NONCE",
      "createdAt": "2026-09-26T10:30:00Z"
    }
  ],
  "nextCursor": "msg_050"
}
```

The backend must not decrypt messages.

Do not return plaintext, encryption keys, derived symmetric keys, or
private keys.

### Edit Message

``` http
PATCH /api/messages/:messageId
```

Request:

``` json
{
  "bodyCiphertext": "NEW_BASE64URL_CIPHERTEXT",
  "nonce": "NEW_BASE64URL_NONCE"
}
```

Response:

``` json
{
  "message": {
    "id": "msg_123",
    "bodyCiphertext": "NEW_BASE64URL_CIPHERTEXT",
    "nonce": "NEW_BASE64URL_NONCE",
    "editedAt": "2026-09-26T10:35:00Z"
  }
}
```

### Delete Message

``` http
DELETE /api/messages/:messageId
```

No request body.

Response:

``` http
204 No Content
```

### Receipt

``` http
POST /api/messages/:messageId/receipt
```

Request:

``` json
{
  "status": "delivered"
}
```

Allowed values:

``` text
delivered
read
```

Do not send `userId` or `messageId`; both are derivable from
authentication context and URL.

Response:

``` http
204 No Content
```

## 10. Attachment API

Files must be encrypted client-side before upload.

Flow:

``` text
Plaintext file
    ↓ client only
Client-side encryption
    ↓
Encrypted file
    ↓
Backend storage
```

### Upload

``` http
POST /api/attachments
```

The exact multipart schema is implementation-dependent, but uploaded
content must be ciphertext.

Required metadata should be limited to what is needed for storage and
retrieval, such as:

``` text
filename
mimeType
size
checksum
```

Never upload plaintext sensitive files or encryption keys.

### Get Attachment

``` http
GET /api/attachments/:attachmentId
```

Backend must authorize access before returning the encrypted content.

Never expose internal storage paths or storage credentials.

### Delete Attachment

``` http
DELETE /api/attachments/:attachmentId
```

No request body.

Response:

``` http
204 No Content
```

## 11. Socket.IO Contract

REST is used for initial state and history. Socket.IO is used for
real-time events.

### Client → Server

#### conversation:join

``` json
{
  "conversationId": "conv_123"
}
```

#### conversation:leave

``` json
{
  "conversationId": "conv_123"
}
```

#### message:send

``` json
{
  "conversationId": "conv_123",
  "bodyCiphertext": "BASE64URL_CIPHERTEXT",
  "nonce": "BASE64URL_NONCE",
  "clientMessageId": "msg_client_123"
}
```

The sender is derived from the authenticated socket session.

#### message:edit

``` json
{
  "messageId": "msg_123",
  "bodyCiphertext": "NEW_BASE64URL_CIPHERTEXT",
  "nonce": "NEW_BASE64URL_NONCE"
}
```

#### message:delete

``` json
{
  "messageId": "msg_123"
}
```

#### message:delivered

``` json
{
  "messageId": "msg_123"
}
```

#### message:read

``` json
{
  "messageId": "msg_123"
}
```

### Server → Client

#### message:new

``` json
{
  "message": {
    "id": "msg_123",
    "conversationId": "conv_123",
    "senderId": "usr_456",
    "bodyCiphertext": "BASE64URL_CIPHERTEXT",
    "nonce": "BASE64URL_NONCE",
    "createdAt": "2026-09-26T10:30:00Z"
  }
}
```

#### message:updated

``` json
{
  "message": {
    "id": "msg_123",
    "bodyCiphertext": "NEW_BASE64URL_CIPHERTEXT",
    "nonce": "NEW_BASE64URL_NONCE",
    "editedAt": "2026-09-26T10:35:00Z"
  }
}
```

#### message:deleted

``` json
{
  "messageId": "msg_123"
}
```

#### message:delivered / message:read

``` json
{
  "messageId": "msg_123"
}
```

Do not resend the entire message when only receipt state changes.

#### user:online / user:offline

``` json
{
  "userId": "usr_456"
}
```

Do not expose session IDs, IP addresses, device identifiers, or
infrastructure metadata.

## 12. Data Minimization Rules

### Never send sensitive plaintext

Forbidden:

``` text
plaintext message
plaintext sensitive attachment
password in response
MFA secret in response
private cryptographic key
session secret
```

### Do not duplicate URL parameters

For:

``` text
POST /api/conversations/:conversationId/messages
```

do not add:

``` json
{
  "conversationId": "..."
}
```

### Do not duplicate authenticated identity

For message creation, do not send:

``` json
{
  "senderId": "..."
}
```

The server derives it from the authenticated session.

### Do not serialize database entities

Do not return fields such as:

``` text
passwordHash
internal database IDs
session data
internal storage keys
security internals
```

Use explicit DTOs.

## 13. Client vs Server Generated Fields

Client-generated:
``` text
bodyCiphertext
nonce
clientMessageId
```
Server-generated: