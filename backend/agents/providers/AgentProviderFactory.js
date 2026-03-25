const { ServerManagedNpcProvider } = require('./ServerManagedNpcProvider');
const { HostedApiKeyProvider } = require('./HostedApiKeyProvider');
const { RemoteEndpointProvider } = require('./RemoteEndpointProvider');
const { OmniRouteRemoteProvider } = require('./adapters/OmniRouteRemoteProvider');

function createAgentProvider({ agent, deps = {} }) {
  if (!agent || !agent.mode) {
    throw new Error('Agent configuration is required');
  }

  if (agent.mode === 'server_managed') {
    return new ServerManagedNpcProvider(deps);
  }

  if (agent.mode === 'hosted_api_key') {
    return new HostedApiKeyProvider(deps);
  }

  if (agent.mode === 'remote_endpoint' && agent.provider === 'omniroute') {
    return new OmniRouteRemoteProvider(deps);
  }

  if (agent.mode === 'remote_endpoint') {
    return new RemoteEndpointProvider(deps);
  }

  throw new Error(`Unsupported agent mode/provider combination: ${agent.mode}/${agent.provider || 'unknown'}`);
}

module.exports = { createAgentProvider };
