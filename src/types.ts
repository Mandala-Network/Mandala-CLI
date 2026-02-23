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
    domains: { frontend?: string; backend?: string; ssl: boolean };
    deploymentId: string | null;
  };
  billing: {
    balance: number;
  };
  sslEnabled: boolean;
  customDomains: {
    frontend?: string;
    backend?: string;
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

export const VALID_LOG_PERIODS = ['5m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '2d', '7d'] as const;
export const VALID_LOG_LEVELS = ['all', 'error', 'warn', 'info'] as const;

export type LogPeriod = typeof VALID_LOG_PERIODS[number];
export type LogLevel = typeof VALID_LOG_LEVELS[number];

export const MAX_TAIL_LINES = 10000;
