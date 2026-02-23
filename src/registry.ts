import chalk from 'chalk';
import Table from 'cli-table3';
import axios from 'axios';
import type { DiscoveredNode } from './types.js';

/**
 * Discover Mandala Network nodes by querying known overlay lookup services.
 *
 * For now, this uses a simple approach: query known SHIP/SLAP endpoints.
 * In the future, this will use the full OverlayClient to query
 * ls_mandala_registry via the BSV overlay network.
 */
export async function discoverNodes(filter?: { gpu?: boolean; gpuType?: string }): Promise<DiscoveredNode[]> {
  // Well-known overlay lookup endpoints for the mandala registry
  const lookupEndpoints = [
    'https://overlay.babbage.systems',
    ...(process.env.MANDALA_LOOKUP_ENDPOINTS?.split(',') || []),
  ].filter(Boolean);

  const discovered: DiscoveredNode[] = [];

  for (const endpoint of lookupEndpoints) {
    try {
      const resp = await axios.post(`${endpoint}/lookup`, {
        service: 'ls_mandala_registry',
        query: {
          type: 'findNodes',
          value: filter || {},
        },
      }, { timeout: 10000 });

      if (Array.isArray(resp.data?.outputs)) {
        for (const output of resp.data.outputs) {
          try {
            const fields = output.fields || [];
            const node: DiscoveredNode = {
              url: fields[1] || '',
              identityKey: fields[2] || '',
              capabilities: JSON.parse(fields[3] || '{}'),
              pricing: JSON.parse(fields[4] || '{}'),
              runtimes: (fields[5] || '').split(',').filter(Boolean),
              lastSeen: fields[6] || '',
            };

            // Apply filters
            if (filter?.gpu && !node.capabilities.gpu) continue;
            if (filter?.gpuType && node.capabilities.gpuType !== filter.gpuType) continue;

            discovered.push(node);
          } catch {
            // Skip malformed output
          }
        }
      }
    } catch {
      // Skip unreachable endpoint
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return discovered.filter(n => {
    if (seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
}

export async function discoverGpuNodes(gpuType?: string): Promise<DiscoveredNode[]> {
  return discoverNodes({ gpu: true, ...(gpuType ? { gpuType } : {}) });
}

/**
 * Discover nodes by directly probing known URLs (fallback when overlay is unavailable).
 */
export async function probeKnownNodes(urls: string[]): Promise<DiscoveredNode[]> {
  const nodes: DiscoveredNode[] = [];

  for (const url of urls) {
    try {
      const resp = await axios.get(`${url}/api/v1/public`, { timeout: 10000 });
      const data = resp.data;
      nodes.push({
        url,
        identityKey: data.nodeId || data.mainnetPublicKey?.publicKey || '',
        capabilities: {
          gpu: data.gpu?.enabled || false,
          gpuType: data.gpu?.type,
          gpuTotal: data.gpu?.total,
          gpuAvailable: data.gpu?.available,
        },
        pricing: data.pricing || {},
        runtimes: data.supportedRuntimes || [],
        lastSeen: new Date().toISOString(),
      });
    } catch {
      // Skip unreachable
    }
  }

  return nodes;
}

export function printDiscoveredNodes(nodes: DiscoveredNode[]) {
  if (nodes.length === 0) {
    console.log(chalk.yellow('No nodes discovered.'));
    return;
  }

  const table = new Table({
    head: ['URL', 'Identity Key', 'GPU', 'GPU Type', 'GPU Avail', 'Runtimes', 'Last Seen'],
  });

  for (const node of nodes) {
    table.push([
      node.url,
      node.identityKey.slice(0, 12) + '...',
      node.capabilities.gpu ? chalk.green('Yes') : 'No',
      node.capabilities.gpuType || '-',
      node.capabilities.gpuAvailable?.toString() || '-',
      node.runtimes.join(', '),
      node.lastSeen ? new Date(node.lastSeen).toLocaleString() : '-',
    ]);
  }

  console.log(table.toString());
}
