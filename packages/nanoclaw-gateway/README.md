# @claw-pilot/nanoclaw-gateway

This package provides a standalone HTTP client for interfacing with NanoClaw devices. It is designed to act as a Gateway skill/backend for the Claw Pilot system.

## Overview

The `NanoClawClient` is a lightweight, `fetch`-based HTTP client that wraps the REST API exposed by a NanoClaw device. It handles authentication, request tracking, error transformations, and JSON serialization/deserialization.

## Usage

If you are incorporating this client within the standard Claw Pilot architecture, it is already integrated into the `apps/backend` Gateway factory. Simply set the following environment variables:

```bash
# Set the backend type to route traffic through the NanoClaw backend
BACKEND_TYPE=nanoclaw

# Set the URL of your NanoClaw device
GATEWAY_URL=http://<IP_ADDRESS>:<PORT>

# If your device requires an authorization token
GATEWAY_TOKEN=your_secret_token
```

### Standalone Usage

If you wish to use the client directly:

```typescript
import { NanoClawClient } from '@claw-pilot/nanoclaw-gateway';

// Initialize the client
const client = new NanoClawClient('http://192.168.1.100:8080', 'optional-token');

// Fetch all agents
const agents = await client.getAgents();

// Fetch live sessions
const sessions = await client.getSessions();

// Spawn a new task
await client.spawnTask('agent-123', 'task-456', 'Analyze the attached logs');
```

## Available Methods

- `getAgents()`
- `createAgent(data)`
- `updateAgent(id, data)`
- `deleteAgent(id)`
- `getSessions()`
- `sendMessage(agentId, message)`
- `spawnTask(agentId, taskId, prompt)`
- `getAgentFile(agentId, fileName)`
- `setAgentFile(agentId, fileName, content)`
- `getModels()`
- `generateConfig(prompt, model)`
