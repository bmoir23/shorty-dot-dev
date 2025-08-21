import { UserPlan } from '../types';

export const PLAN_FEATURES: Record<string, UserPlan> = {
    free: {
        tier: 'free',
        features: {
            customDomains: false,
            bulkCreation: false,
            analytics: false,
            passwordProtection: false,
            qrCodes: false,
            aiAgentDeployment: false,
            apiAccess: false,
        },
    },
    basic: {
        tier: 'basic',
        features: {
            customDomains: true,
            bulkCreation: true,
            analytics: true,
            passwordProtection: true,
            qrCodes: true,
            aiAgentDeployment: false,
            apiAccess: true,
        },
    },
    pro: {
        tier: 'pro',
        features: {
            customDomains: true,
            bulkCreation: true,
            analytics: true,
            passwordProtection: true,
            qrCodes: true,
            aiAgentDeployment: true,
            apiAccess: true,
        },
    },
    teams: {
        tier: 'teams',
        features: {
            customDomains: true,
            bulkCreation: true,
            analytics: true,
            passwordProtection: true,
            qrCodes: true,
            aiAgentDeployment: true,
            apiAccess: true,
        },
    },
    ultra: {
        tier: 'ultra',
        features: {
            customDomains: true,
            bulkCreation: true,
            analytics: true,
            passwordProtection: true,
            qrCodes: true,
            aiAgentDeployment: true,
            apiAccess: true,
        },
    },
};

export function getUserPlan(tier: string): UserPlan {
    return PLAN_FEATURES[tier] || PLAN_FEATURES.free;
}

export function canUseFeature(userTier: string, feature: keyof UserPlan['features']): boolean {
    const plan = getUserPlan(userTier);
    return plan.features[feature];
}