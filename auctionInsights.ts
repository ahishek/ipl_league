import type { AuctionConfig, Player, Position, Team } from './types';

export const ROLE_ORDER: Position[] = ['Batter', 'Bowler', 'All Rounder', 'Wicket Keeper'];

export type TeamConstraintState = {
  isPossible: boolean;
  reason?: string;
  slotsLeft: number;
  minimumRequiredBudget: number;
  missingRoles: Record<Position, number>;
};

export type BidEvaluation = {
  canBid: boolean;
  reason?: string;
  budgetAfterBid: number;
  constraintState: TeamConstraintState;
};

export const getRoleCounts = (roster: Player[]) =>
  roster.reduce(
    (acc, player) => {
      acc[player.position] += 1;
      return acc;
    },
    {
      Batter: 0,
      Bowler: 0,
      'All Rounder': 0,
      'Wicket Keeper': 0,
    } as Record<Position, number>,
  );

export const getRoleShortLabel = (role: Position) => {
  if (role === 'Wicket Keeper') return 'WK';
  if (role === 'All Rounder') return 'AR';
  return role;
};

export const getPendingPlayers = (players: Player[]) =>
  players.filter((player) => player.status === 'PENDING' || player.status === 'ON_AUCTION');

export const buildTeamConstraintState = (
  config: AuctionConfig,
  roster: Player[],
  availablePlayers: Player[],
): TeamConstraintState => {
  const slotsLeft = Math.max(0, config.maxPlayers - roster.length);
  const roleCounts = getRoleCounts(roster);
  const missingRoles = ROLE_ORDER.reduce(
    (acc, role) => {
      acc[role] = Math.max(0, config.roleMinimums[role] - roleCounts[role]);
      return acc;
    },
    {
      Batter: 0,
      Bowler: 0,
      'All Rounder': 0,
      'Wicket Keeper': 0,
    } as Record<Position, number>,
  );

  if (slotsLeft === 0) {
    const unmetRole = ROLE_ORDER.find((role) => missingRoles[role] > 0);
    if (unmetRole) {
      return {
        isPossible: false,
        reason: `Squad is full but still missing ${missingRoles[unmetRole]} ${getRoleShortLabel(unmetRole)}.`,
        slotsLeft,
        minimumRequiredBudget: 0,
        missingRoles,
      };
    }

    return {
      isPossible: true,
      slotsLeft,
      minimumRequiredBudget: 0,
      missingRoles,
    };
  }

  const mandatorySlots = ROLE_ORDER.reduce((sum, role) => sum + missingRoles[role], 0);
  if (mandatorySlots > slotsLeft) {
    return {
      isPossible: false,
      reason: 'Role minimums exceed the squad slots left.',
      slotsLeft,
      minimumRequiredBudget: 0,
      missingRoles,
    };
  }

  const poolByRole = new Map<Position, Player[]>();
  ROLE_ORDER.forEach((role) => {
    poolByRole.set(
      role,
      availablePlayers
        .filter((player) => player.position === role)
        .sort((left, right) => left.basePrice - right.basePrice),
    );
  });

  const selectedIds = new Set<string>();
  let minimumRequiredBudget = 0;

  for (const role of ROLE_ORDER) {
    const shortage = missingRoles[role];
    if (!shortage) continue;

    const candidates = poolByRole.get(role) || [];
    if (candidates.length < shortage) {
      return {
        isPossible: false,
        reason: `Not enough ${getRoleShortLabel(role)} options remain in the pool.`,
        slotsLeft,
        minimumRequiredBudget: 0,
        missingRoles,
      };
    }

    for (const player of candidates.slice(0, shortage)) {
      selectedIds.add(player.id);
      minimumRequiredBudget += player.basePrice;
    }
  }

  const generalSlots = slotsLeft - mandatorySlots;
  const cheapestRemaining = availablePlayers
    .filter((player) => !selectedIds.has(player.id))
    .sort((left, right) => left.basePrice - right.basePrice);

  if (cheapestRemaining.length < generalSlots) {
    return {
      isPossible: false,
      reason: 'Not enough players remain to complete the squad.',
      slotsLeft,
      minimumRequiredBudget,
      missingRoles,
    };
  }

  minimumRequiredBudget += cheapestRemaining
    .slice(0, generalSlots)
    .reduce((sum, player) => sum + player.basePrice, 0);

  return {
    isPossible: true,
    slotsLeft,
    minimumRequiredBudget,
    missingRoles,
  };
};

export const evaluateBidCapacity = (
  config: AuctionConfig,
  team: Pick<Team, 'budget' | 'roster'>,
  currentPlayer: Player,
  bidAmount: number,
  availablePlayersAfterWin: Player[],
): BidEvaluation => {
  const budgetAfterBid = team.budget - bidAmount;
  if (budgetAfterBid < 0) {
    return {
      canBid: false,
      reason: 'Insufficient budget.',
      budgetAfterBid,
      constraintState: buildTeamConstraintState(config, team.roster, availablePlayersAfterWin),
    };
  }

  const rosterAfterWin = [...team.roster, { ...currentPlayer, status: 'SOLD' as const, soldPrice: bidAmount }];
  const constraintState = buildTeamConstraintState(config, rosterAfterWin, availablePlayersAfterWin);

  if (!constraintState.isPossible) {
    return {
      canBid: false,
      reason: constraintState.reason || 'This bid would make the squad impossible to complete.',
      budgetAfterBid,
      constraintState,
    };
  }

  if (budgetAfterBid < constraintState.minimumRequiredBudget) {
    return {
      canBid: false,
      reason: `Need ${constraintState.minimumRequiredBudget}L reserved to finish the squad legally.`,
      budgetAfterBid,
      constraintState,
    };
  }

  return {
    canBid: true,
    budgetAfterBid,
    constraintState,
  };
};
