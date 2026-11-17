const DIPLOMACY_CONFIG = Object.freeze({
  agreementTypes: Object.freeze({
    cooperation: Object.freeze({
      id: 'cooperation',
      label: 'Cooperation Agreement',
      baseCostFunding: 1500000,
      counterCostFunding: 750000,
      relationGainOnAccept: 12,
      allowedDurationsGameDays: Object.freeze([30, 60, 90]),
    }),
  }),
  proposalExpiryGameDays: 7,
  cooldownGameDays: 2,
  crossBloc: Object.freeze({
    cooldownGameDays: 5,
    costMultiplier: 1.75,
    acceptancePenalty: 25,
  }),
  limits: Object.freeze({
    maxPendingOutgoingPerAgency: 3,
    maxPendingIncomingPerAgency: 6,
    maxPendingPerPair: 1,
    maxCounterDepth: 1,
    rateLimitWindowMs: 60000,
    rateLimitMaxProposals: 4,
  }),
  relation: Object.freeze({
    initialScore: 50,
    minScore: 0,
    maxScore: 100,
    gainOnAccept: 12,
    rejectionPenalty: 3,
    terminationPenalty: 12,
    cooperativeThreshold: 60,
    alliedThreshold: 80,
    sameBlocAcceptanceBonus: 10,
  }),
  acceptance: Object.freeze({
    highThreshold: 75,
    mediumThreshold: 50,
  }),
  saturationRatio: 0.25,
  notes: Object.freeze({
    maxLength: 280,
  }),
  npc: Object.freeze({
    tickIntervalGameDays: 0.25,
    staggerBuckets: 4,
    maxActionsPerTick: 1,
    maxResponsesPerTick: 1,
    maxProposalAttempts: 2,
    maxTargetCandidates: 8,
    rosterPerBloc: 6,
    defaultProfile: 'opportunistic',
    profiles: Object.freeze({
      cooperative: Object.freeze({
        initiateChance: 0.55,
        acceptChance: 0.72,
        counterChance: 0.12,
        crossBlocAcceptPenalty: 0.3,
        crossBlocInitiationPenalty: 0.55,
        sameBlocBonus: 0.16,
      }),
      opportunistic: Object.freeze({
        initiateChance: 0.42,
        acceptChance: 0.52,
        counterChance: 0.24,
        crossBlocAcceptPenalty: 0.12,
        crossBlocInitiationPenalty: 0.15,
        sameBlocBonus: 0.05,
      }),
      isolationist: Object.freeze({
        initiateChance: 0.12,
        acceptChance: 0.28,
        counterChance: 0.06,
        crossBlocAcceptPenalty: 0.55,
        crossBlocInitiationPenalty: 0.85,
        sameBlocBonus: 0.24,
      }),
    }),
  }),
});

function getPublicPolicy(config = DIPLOMACY_CONFIG) {
  return {
    agreementTypes: Object.values(config.agreementTypes).map((type) => ({
      id: type.id,
      label: type.label,
      costFunding: type.baseCostFunding,
      counterCostFunding: type.counterCostFunding,
      allowedDurationsGameDays: [...type.allowedDurationsGameDays],
      relationGain: type.relationGainOnAccept,
    })),
    proposalExpiryGameDays: config.proposalExpiryGameDays,
    cooldownGameDays: config.cooldownGameDays,
    crossBloc: {
      cooldownGameDays: config.crossBloc.cooldownGameDays,
      costMultiplier: config.crossBloc.costMultiplier,
    },
    limits: {
      maxPendingOutgoingPerAgency: config.limits.maxPendingOutgoingPerAgency,
      maxPendingIncomingPerAgency: config.limits.maxPendingIncomingPerAgency,
      maxPendingPerPair: config.limits.maxPendingPerPair,
      maxCounterDepth: config.limits.maxCounterDepth,
    },
    noteMaxLength: config.notes.maxLength,
    saturationRatio: config.saturationRatio,
  };
}

module.exports = {
  DIPLOMACY_CONFIG,
  getPublicPolicy,
};
