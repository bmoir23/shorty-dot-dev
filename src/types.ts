export interface UserPlan {
    tier: 'free' | 'basic' | 'pro' | 'teams' | 'ultra';
    features: {
        customDomains: boolean;
        bulkCreation: boolean;
        analytics: boolean;
        passwordProtection: boolean;
        qrCodes: boolean;
        aiAgentDeployment: boolean;
        apiAccess: boolean;
    };
}

export interface ShortLink {
    slug: string;
    url: string;
    createdAt: string;
    expiresAt?: string;
    password?: string;
    clicks: number;
    isActive: boolean;
    customDomain?: string;
    qrCode?: string;
    userId?: string;
}

export interface AIAgent {
    id: string;
    name: string;
    description: string;
    model: string;
    provider: 'workers-ai' | 'openrouter' | 'openai';
    endpoint: string;
    systemPrompt: string;
    isActive: boolean;
    userId: string;
    createdAt: string;
    deploymentUrl: string;
}

export interface AgentDeploymentConfig {
    name: string;
    description: string;
    model: string;
    provider: 'workers-ai' | 'openrouter' | 'openai';
    systemPrompt: string;
    customDomain?: string;
    rateLimits?: {
        requestsPerMinute: number;
        requestsPerDay: number;
    };
}