const { RemoteEndpointProvider } = require('../RemoteEndpointProvider');

class OmniRouteRemoteProvider extends RemoteEndpointProvider {
  async decide({ agent, observation, policy = {} }) {
    return super.decide({
      agent,
      observation: {
        ...observation,
        transport: {
          kind: 'omniroute-http',
          version: 'v1',
        },
      },
      policy: {
        ...policy,
        adapter: 'omniroute',
        routeHint: agent.routeHint || 'gardenquest-agent',
      },
    });
  }
}

module.exports = { OmniRouteRemoteProvider };
