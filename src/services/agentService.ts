import { AIAgent, AgentDeploymentConfig } from '../types';

export class AgentService {
    constructor(private env: any) { }

    async deployAgent(config: AgentDeploymentConfig, userId: string): Promise<AIAgent> {
        const agentId = crypto.randomUUID();
        const deploymentUrl = `https://agent-${agentId}.${this.env.CUSTOM_DOMAIN || 'shrty.dev'}`;

        const agent: AIAgent = {
            id: agentId,
            name: config.name,
            description: config.description,
            model: config.model,
            provider: config.provider,
            endpoint: `/api/agents/${agentId}/chat`,
            systemPrompt: config.systemPrompt,
            isActive: true,
            userId,
            createdAt: new Date().toISOString(),
            deploymentUrl,
        };

        // Store agent configuration in KV
        await this.env.AGENTS.put(`agent:${agentId}`, JSON.stringify(agent));

        // Create AI Gateway endpoint if using Workers AI
        if (config.provider === 'workers-ai') {
            await this.createAIGatewayEndpoint(agentId, config);
        }

        return agent;
    }

    async getAgent(agentId: string): Promise<AIAgent | null> {
        const agentData = await this.env.AGENTS.get(`agent:${agentId}`);
        return agentData ? JSON.parse(agentData) : null;
    }

    async getUserAgents(userId: string): Promise<AIAgent[]> {
        const { keys } = await this.env.AGENTS.list({ prefix: 'agent:' });
        const agents: AIAgent[] = [];

        for (const key of keys) {
            const agentData = await this.env.AGENTS.get(key.name);
            if (agentData) {
                const agent = JSON.parse(agentData);
                if (agent.userId === userId) {
                    agents.push(agent);
                }
            }
        }

        return agents;
    }

    private async createAIGatewayEndpoint(agentId: string, config: AgentDeploymentConfig) {
        // This would integrate with Cloudflare AI Gateway
        // For now, we'll store the configuration for the chat endpoint
        const gatewayConfig = {
            agentId,
            model: config.model,
            provider: config.provider,
            systemPrompt: config.systemPrompt,
        };

        await this.env.AGENTS.put(`gateway:${agentId}`, JSON.stringify(gatewayConfig));
    }

    async chatWithAgent(agentId: string, messages: any[]): Promise<any> {
        const agent = await this.getAgent(agentId);
        if (!agent || !agent.isActive) {
            throw new Error('Agent not found or inactive');
        }

        const gatewayConfig = await this.env.AGENTS.get(`gateway:${agentId}`);
        if (!gatewayConfig) {
            throw new Error('Agent gateway configuration not found');
        }

        const config = JSON.parse(gatewayConfig);

        // Add system message
        const systemMessage = {
            role: 'system',
            content: config.systemPrompt,
        };

        const fullMessages = [systemMessage, ...messages];

        // Route to appropriate AI provider
        switch (agent.provider) {
            case 'workers-ai':
                return await this.env.AI.run(config.model, { messages: fullMessages });

            case 'openrouter':
                return await this.callOpenRouter(config.model, fullMessages);

            case 'openai':
                return await this.callOpenAI(config.model, fullMessages);

            default:
                throw new Error('Unsupported AI provider');
        }
    }

    private async callOpenRouter(model: string, messages: any[]) {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
            }),
        });

        return await response.json();
    }

    private async callOpenAI(model: string, messages: any[]) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
            }),
        });

        return await response.json();
    }
}