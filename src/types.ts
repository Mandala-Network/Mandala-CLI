/**
 * Mandala CLI Types
 */

export interface MandalaConfigInfo {
  schema: string;
  schemaVersion: string;
  topicManagers?: Record<string, string>;
  lookupServices?: Record<string, { serviceFactory: string; hydrateWith?: string }>;
  frontend?: { language: string; sourceDirectory: string };
  contracts?: { language: string; baseDirectory: string };
  configs?: MandalaConfig[];
}

export interface MandalaConfig {
  name: string;
  network?: string;
  provider: string; // "CARS", "mandala", "LARS" or another provider
  projectID?: string;
  MandalaCloudURL?: string;
  deploy?: string[]; // which parts to release: "frontend", "backend"
  frontendHostingMethod?: string;
  authentication?: any;
  payments?: any;
}

export interface ProjectInfo {
  id: string;
  name: string;
  network: string;
  status: {
    online: boolean;
    lastChecked: string;
    domains: { frontend?: string; agent?: string; ssl: boolean };
    deploymentId: string | null;
  };
  billing: {
    balance: number;
  };
  sslEnabled: boolean;
  customDomains: {
    frontend?: string;
    agent?: string;
  };
  webUIConfig: any;
  agentConfig?: Record<string, string>;
}

export interface ProjectListing {
  id: string;
  name: string;
  balance: string;
  created_at: string;
  network: 'mainnet' | 'testnet';
}

export interface AdminInfo {
  identity_key: string;
  email: string;
  added_at: string;
}

export interface DeployInfo {
  deployment_uuid: string;
  created_at: string;
}

export interface AccountingRecord {
  id: number;
  project_id: number;
  deploy_id?: number;
  timestamp: string;
  type: 'credit' | 'debit';
  metadata: any;
  amount_sats: string;
  balance_after: string;
}

export interface AgentManifest {
  schema: 'mandala-agent';
  schemaVersion: '1.0';
  agent: {
    type: 'openclaw' | 'agidentity' | 'custom';
    image?: string;
    dockerfile?: string;
    buildContext?: string;
    runtime?: 'node' | 'python' | 'docker';
  };
  env?: Record<string, string>;
  resources?: { cpu?: string; memory?: string; gpu?: string };
  ports?: number[];
  healthCheck?: { path: string; port?: number; intervalSeconds?: number };
  frontend?: { directory?: string; image?: string };
  storage?: { enabled: boolean; size?: string; mountPath?: string };
  databases?: { mysql?: boolean; mongo?: boolean; redis?: boolean };
  deployments?: Array<{ provider: 'mandala'; projectID?: string; network?: string; MandalaCloudURL?: string }>;
}

// ---------- V2 Manifest Types ----------

export interface ServiceDefinition {
  agent: {
    type: 'openclaw' | 'agidentity' | 'custom';
    image?: string;
    dockerfile?: string;
    buildContext?: string;
    runtime?: 'node' | 'python' | 'docker';
  };
  env?: Record<string, string>;
  resources?: { cpu?: string; memory?: string; gpu?: string };
  ports?: number[];
  healthCheck?: { path: string; port?: number; intervalSeconds?: number };
  frontend?: { directory?: string; image?: string } | null;
  storage?: { enabled: boolean; size?: string; mountPath?: string };
  databases?: { mysql?: boolean; mongo?: boolean; redis?: boolean };
  provider?: string;
}

export interface ServiceLink {
  from: string;
  to: string;
  envVar: string;
}

export interface DeploymentTarget {
  name: string;
  provider: 'mandala';
  MandalaCloudURL: string;
  projectID?: string;
  network?: string;
  capabilities?: {
    gpu?: boolean;
    gpuType?: string;
  };
}

export interface AgentManifestV2 {
  schema: 'mandala-agent';
  schemaVersion: '2.0';
  services: Record<string, ServiceDefinition>;
  links?: ServiceLink[];
  env?: Record<string, string>;
  deployments?: DeploymentTarget[];
}

export function isV2Manifest(m: any): m is AgentManifestV2 {
  return m?.schemaVersion === '2.0' && m?.services != null;
}

export interface NodeCapabilities {
  url: string;
  gpu: { enabled: boolean; type?: string; total?: number; available?: number; rate_per_unit_5min?: number };
  pricing: Record<string, number>;
  supportedRuntimes: string[];
  schemaVersionsSupported: string[];
}

export interface DiscoveredNode {
  url: string;
  identityKey: string;
  capabilities: { gpu: boolean; gpuType?: string; gpuTotal?: number; gpuAvailable?: number };
  pricing: Record<string, number>;
  runtimes: string[];
  lastSeen: string;
}

export const VALID_LOG_PERIODS = ['5m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '2d', '7d'] as const;
export const VALID_LOG_LEVELS = ['all', 'error', 'warn', 'info'] as const;

export type LogPeriod = typeof VALID_LOG_PERIODS[number];
export type LogLevel = typeof VALID_LOG_LEVELS[number];

export const MAX_TAIL_LINES = 10000;
