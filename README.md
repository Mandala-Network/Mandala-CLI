# Mandala CLI

Command-line interface for deploying and managing AI agents on the Mandala Network. Deploy AGIdentity instances, manage projects, monitor resources, and handle billing — all authenticated with your BSV identity.

## Install

```bash
# Global install
npm install -g @bsv/mandala-cli

# Or run without installing
npx @bsv/mandala-cli
```

**Requirements:** Node.js 20+, BSV private key (64-char hex)

## Quick Start

```bash
# Launch interactive wizard
mandala

# Or jump straight to deploying an agent
mandala agent deploy
```

On first run the CLI will prompt for your BSV private key and guide you through connecting to a Mandala Network node.

## How It Works

```
mandala-cli (your machine)
    ↓  BRC-103 signed API calls
Mandala Network Node
    ↓  provisions
Kubernetes → Agent Pod + SSL + Databases
```

The CLI uses your BSV private key to authenticate every request. No passwords, no tokens — your cryptographic identity is your credential.

## Commands

### Configuration

Manage connections to Mandala Network nodes. Each config targets a specific node URL and project.

```bash
mandala config ls                    # List all configs
mandala config add                   # Add a new node config
mandala config edit <nameOrIndex>    # Edit a config
mandala config delete <nameOrIndex>  # Delete a config
```

### Agent Deployment

Deploy and manage AI agents (AGIdentity, OpenClaw, or custom).

```bash
mandala agent init                   # Create agent-manifest.json
mandala agent deploy [config]        # Deploy agent to a node
mandala agent status [config]        # View agent status
mandala agent logs [config]          # View agent logs
mandala agent restart [config]       # Restart agent
mandala agent config get [config]    # Get agent env vars
mandala agent config set <k> <v>     # Set agent env var
```

**Log options:**

```bash
mandala agent logs --since 1h --tail 1000 --level error
```

### Project Management

```bash
mandala project ls [config]                          # List projects on a node
mandala project info [config]                        # Detailed project info
mandala project logs [config]                        # Project-level logs
mandala project releases [config]                    # List all releases
mandala project topup [config] --amount 100000       # Add funds (satoshis)
mandala project delete [config] --force              # Delete project
```

**Admin management:**

```bash
mandala project add-admin <identityKey> [config]     # Add admin
mandala project remove-admin <identityKey> [config]  # Remove admin
mandala project list-admins [config]                 # List admins
```

**Custom domains:**

```bash
mandala project domain:frontend <domain> [config]    # Set frontend domain
mandala project domain:backend <domain> [config]     # Set backend domain
```

**Resource logs:**

```bash
mandala project resource-logs [config] --resource backend --since 1h
# Resources: frontend, backend, mysql, mongo, redis
```

**Billing:**

```bash
mandala project billing-stats [config] --start 2025-01-01 --end 2025-12-31
```

### Releases

```bash
mandala release now [config]                         # Build + upload + deploy
mandala release get-upload-url [config]              # Get signed upload URL
mandala release upload-files <url> <artifact>        # Upload artifact
mandala release logs [releaseId] [config]            # Deployment logs
```

### Artifacts (Overlay Apps)

```bash
mandala build [config]              # Build artifact from mandala.json
mandala artifact ls                 # List local artifacts
mandala artifact delete <name>      # Delete local artifact
```

### Global

```bash
mandala global-info [config]        # Node info (pricing, public keys)
mandala --version                   # CLI version
mandala --help                      # Help
```

## Agent Manifest

Create `agent-manifest.json` in your project root (or run `mandala agent init`):

```json
{
  "schema": "mandala-agent",
  "schemaVersion": "1.0",
  "agent": {
    "type": "agidentity",
    "runtime": "node"
  },
  "env": {
    "AGID_MODEL": "claude-sonnet-4-5-20250929",
    "ANTHROPIC_API_KEY": "sk-..."
  },
  "resources": {
    "cpu": "500m",
    "memory": "512Mi"
  },
  "ports": [3000],
  "healthCheck": {
    "path": "/health",
    "port": 3000
  },
  "storage": {
    "enabled": true,
    "size": "10Gi",
    "mountPath": "/data"
  },
  "databases": {
    "redis": true
  }
}
```

### Agent Types

| Type | Description |
|------|-------------|
| `agidentity` | AGIdentity autonomous BSV wallet agent |
| `openclaw` | General-purpose AI agent |
| `custom` | Your own implementation |

### Build Options

| Method | Field | Use Case |
|--------|-------|----------|
| Auto-generated | `agent.runtime: "node"` or `"python"` | Standard apps |
| Custom Dockerfile | `agent.dockerfile: "./Dockerfile"` | Specific build needs |
| Pre-built image | `agent.image: "registry/image:tag"` | Existing Docker images |

## Overlay App Config

For BSV overlay applications, use `mandala.json`:

```json
{
  "schema": "bsv-app",
  "schemaVersion": "1.0",
  "frontend": {
    "language": "react",
    "sourceDirectory": "frontend"
  },
  "configs": [
    {
      "name": "production",
      "provider": "mandala",
      "MandalaCloudURL": "https://your-node.com",
      "projectID": "abc123",
      "network": "mainnet",
      "deploy": ["frontend", "backend"]
    }
  ]
}
```

## Deployment Workflow

1. **Package** — CLI creates a `.tgz` archive of your project (excludes `node_modules`, `.git`, etc.)
2. **Request upload** — CLI gets a signed upload URL from the node
3. **Upload** — Artifact is uploaded to the node
4. **Build** — Node extracts the archive, builds a Docker image
5. **Deploy** — Kubernetes deployment, service, and ingress are created
6. **SSL** — cert-manager provisions a Let's Encrypt certificate
7. **Live** — Your agent is accessible at `https://agent.{projectId}.{domain}`

## Programmatic Usage

The CLI's functionality is also available as a library via `MandalaClient`:

```typescript
import { MandalaClient } from './integrations/mandala/mandala-client'

const client = new MandalaClient(wallet)
const projects = await client.listProjects('https://your-node.com')
const info = await client.getProjectInfo(nodeUrl, projectId)
```

## License

OpenBSV
