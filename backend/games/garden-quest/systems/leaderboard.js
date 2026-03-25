function createLeaderboardSystem({
  getTopGameScores,
  getTopSoccerScorers,
  LEADERBOARD_LIMIT,
  LEADERBOARD_REFRESH_MS,
}) {
  function maybeRefreshLeaderboards(engine, now = Date.now()) {
    if ((now - engine.state.leaderboardLastUpdatedAt) >= LEADERBOARD_REFRESH_MS) {
      engine.refreshLeaderboard().catch((error) => {
        engine.logger.error('Leaderboard refresh failed:', error.message);
      });
    }

    if ((now - engine.state.soccerLeaderboardLastUpdatedAt) >= LEADERBOARD_REFRESH_MS) {
      engine.refreshSoccerLeaderboard().catch((error) => {
        engine.logger.error('Soccer leaderboard refresh failed:', error.message);
      });
    }
  }

  async function refreshLeaderboard(engine) {
    if (engine.state.leaderboardRefreshInFlight) {
      return;
    }

    engine.state.leaderboardRefreshInFlight = true;

    try {
      engine.state.leaderboard = await getTopGameScores(LEADERBOARD_LIMIT);
      engine.state.leaderboardLastUpdatedAt = Date.now();
    } finally {
      engine.state.leaderboardRefreshInFlight = false;
    }
  }

  async function refreshSoccerLeaderboard(engine) {
    if (engine.state.soccerLeaderboardRefreshInFlight) {
      return;
    }

    engine.state.soccerLeaderboardRefreshInFlight = true;

    try {
      engine.state.soccerLeaderboard = await getTopSoccerScorers(LEADERBOARD_LIMIT);
      engine.state.soccerLeaderboardLastUpdatedAt = Date.now();
    } finally {
      engine.state.soccerLeaderboardRefreshInFlight = false;
    }
  }

  return Object.freeze({
    maybeRefreshLeaderboards,
    refreshLeaderboard,
    refreshSoccerLeaderboard,
  });
}

module.exports = {
  createLeaderboardSystem,
};
