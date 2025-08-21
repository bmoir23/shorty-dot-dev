import { runWithTools } from '@cloudflare/ai-utils';
import { Hono } from 'hono';
import { jwt, sign } from 'hono/jwt';
import { stripIndents } from 'common-tags';
import { streamText } from 'hono/streaming';
import { events } from 'fetch-event-stream';
import { coerceBoolean } from 'cloudflare/core.mjs';
import { AgentService } from './services/agentService';
import { canUseFeature } from './services/planService';
import { AgentDeploymentConfig } from './types';

type Bindings = {
	[key in keyof CloudflareBindings]: CloudflareBindings[key];
};

// Enhanced URL creation with additional features
async function createEnhancedUrl(env: Bindings, slug: string, url: string, options: {
	override?: boolean;
	expiresAt?: string;
	password?: string;
	customDomain?: string;
	userId?: string;
} = {}) {
	const existing = await env.URLS.get(slug);

	if (existing !== null && !options.override) {
		const existingData = JSON.parse(existing);
		return {
			slug,
			url: existingData.url,
			shorty: `/${slug}`,
			message: `Slug ${slug} already exists. Set override to true to update.`,
		};
	}

	const linkData = {
		url,
		createdAt: new Date().toISOString(),
		expiresAt: options.expiresAt,
		password: options.password,
		customDomain: options.customDomain,
		userId: options.userId,
		clicks: 0,
		isActive: true,
	};

	await env.URLS.put(slug, JSON.stringify(linkData));

	return {
		slug,
		url,
		shorty: `/${slug}`,
		...linkData
	};
}

const app = new Hono<{ Bindings: Bindings }>();

// Secure all the API routes
app.use('/api/*', (c, next) => {
	const jwtMiddleware = jwt({
		secret: c.env.JWT_SECRET,
	});
	return jwtMiddleware(c, next);
});

// Generate a signed token
app.post("/tmp/token", async (c) => {
	const payload = await c.req.json();
	console.log({ payload });
	const token = await sign(payload, c.env.JWT_SECRET);
	return c.json({ token });
});

async function addUrl(env: Bindings, slug: string, url: string, override: boolean = false) {
	const existing = await env.URLS.get(slug);
	console.log({ slug, url, override });
	if (existing !== null) {
		if (coerceBoolean(override) === true) {
			console.log(`Overriding shorty ${slug}`);
		} else {
			return {
				slug,
				url: existing,
				shorty: `/${slug}`,
				message: `Did not update ${slug} because it already was pointing to ${existing} and override was set to ${override}.`,
			};
		}
	}
	await env.URLS.put(slug, url);
	return { slug, url, shorty: `/${slug}` };
}

app.post('/api/url', async (c) => {
	const payload = await c.req.json();
	const result = await addUrl(c.env, payload.slug, payload.url, payload.override);
	return c.json(result);
});

async function queryClicks(env: Bindings, sql: string) {
	console.log(sql);
	const API = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`;
	const response = await fetch(API, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
		},
		body: sql,
	});
	const jsonResponse = await response.json();
	// @ts-ignore
	return jsonResponse.data;
}

app.post('/api/report/:slug', async (c) => {
	const sql = `SELECT blob4 as 'country', COUNT() as 'total' FROM link_clicks WHERE blob1='${c.req.param('slug')}' GROUP BY country`;
	const results = await queryClicks(c.env, sql);
	return c.json(results);
});

// Enhanced URL creation endpoint
app.post('/api/url/enhanced', async (c) => {
	const payload = await c.req.json();
	const userTier = c.req.header('X-User-Tier') || 'free';

	// Check feature permissions
	if (payload.password && !canUseFeature(userTier, 'passwordProtection')) {
		return c.json({ error: 'Password protection requires Pro plan or higher' }, 403);
	}

	if (payload.customDomain && !canUseFeature(userTier, 'customDomains')) {
		return c.json({ error: 'Custom domains require Basic plan or higher' }, 403);
	}

	const result = await createEnhancedUrl(c.env, payload.slug, payload.url, {
		override: payload.override,
		expiresAt: payload.expiresAt,
		password: payload.password,
		customDomain: payload.customDomain,
		userId: payload.userId,
	});

	return c.json(result);
});

// AI Agent Deployment Endpoints (Pro+ only)
app.post('/api/agents/deploy', async (c) => {
	const userTier = c.req.header('X-User-Tier') || 'free';
	const userId = c.req.header('X-User-ID');

	if (!canUseFeature(userTier, 'aiAgentDeployment')) {
		return c.json({
			error: 'AI Agent deployment requires Pro plan or higher',
			upgradeUrl: '/pricing'
		}, 403);
	}

	if (!userId) {
		return c.json({ error: 'User ID required' }, 401);
	}

	const config: AgentDeploymentConfig = await c.req.json();
	const agentService = new AgentService(c.env);

	try {
		const agent = await agentService.deployAgent(config, userId);
		return c.json({
			success: true,
			agent,
			deploymentUrl: agent.deploymentUrl,
			endpoint: agent.endpoint
		});
	} catch (error) {
		return c.json({ error: 'Failed to deploy agent' }, 500);
	}
});

app.get('/api/agents', async (c) => {
	const userId = c.req.header('X-User-ID');
	if (!userId) {
		return c.json({ error: 'User ID required' }, 401);
	}

	const agentService = new AgentService(c.env);
	const agents = await agentService.getUserAgents(userId);
	return c.json({ agents });
});

app.post('/api/agents/:agentId/chat', async (c) => {
	const agentId = c.req.param('agentId');
	const { messages } = await c.req.json();

	const agentService = new AgentService(c.env);

	try {
		const response = await agentService.chatWithAgent(agentId, messages);
		return c.json(response);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

app.get('/api/agents/:agentId', async (c) => {
	const agentId = c.req.param('agentId');
	const agentService = new AgentService(c.env);

	const agent = await agentService.getAgent(agentId);
	if (!agent) {
		return c.json({ error: 'Agent not found' }, 404);
	}

	return c.json({ agent });
});

// TODO: Remove temporary hack
const SHORTY_SYSTEM_MESSAGE = stripIndents`
You are an assistant for the URL Shortening service named shrty.dev.

Each shortened link is called a shorty. Each shorty starts with the current hostname and then is followed by a forward slash and then the slug.

You are jovial and want to encourage people to create great shortened links.

When doing function calling ensure that boolean values are ALWAYS lowercased, eg: instead of True use true.
`;


app.post('/admin/chat', async (c) => {
	const payload = await c.req.json();
	const messages = payload.messages || [];
	//console.log({ submittedMessages: messages });
	messages.unshift({
		role: 'system',
		content: SHORTY_SYSTEM_MESSAGE,
	});

	const eventSourceStream = await runWithTools(
		c.env.AI,
		'@hf/nousresearch/hermes-2-pro-mistral-7b',
		{
			messages,
			tools: [
				{
					name: 'createShorty',
					description: 'Creates a new short link',
					parameters: {
						type: 'object',
						properties: {
							slug: {
								type: 'string',
								description: 'The shortened part of the url.',
							},
							url: {
								type: 'string',
								description: 'The final destination where the shorty should redirect. Should start with https://',
							},
							override: {
								type: 'boolean',
								description:
									'Will override if there is an existing shorty at that slug. Default is false.',
							},
						},
						required: ['slug', 'url'],
					},
					function: async ({ slug, url, override }) => {
						const result = await addUrl(c.env, slug, url, override);
						return JSON.stringify(result);
					},
				},
				{
					name: 'getClicksByCountryReport',
					description: 'Returns a report of all clicks on a specific shorty grouped by country',
					parameters: {
						type: 'object',
						properties: {
							slug: {
								type: 'string',
								description: 'The shortened part of the url',
							},
						},
						required: ['slug'],
					},
					function: async ({ slug }) => {
						const sql = stripIndents`
							SELECT
								blob4 as 'country',
								COUNT() as 'total'
							FROM
								link_clicks
							WHERE blob1='${slug}'
							GROUP BY country`;
						const result = await queryClicks(c.env, sql);
						return JSON.stringify(result);
					},
				},
			],
		},
		{
			streamFinalResponse: true,
			verbose: true,
		}
	);

	return streamText(c, async (stream) => {
		const chunks = events(new Response(eventSourceStream as ReadableStream));
		for await (const chunk of chunks) {
			if (chunk.data && chunk.data !== '[DONE]' && chunk.data !== '<|im_end|>') {
				const data = JSON.parse(chunk.data);
				stream.write(data.response);
			}
		}
	});
});

app.get('/:slug', async (c) => {
	const slug = c.req.param('slug');
	const url = await c.env.URLS.get(slug);
	if (url === null) {
		return c.status(404);
	}
	const cfProperties = c.req.raw.cf;
	if (cfProperties !== undefined) {
		if (c.env.TRACKER !== undefined) {
			c.env.TRACKER.writeDataPoint({
				blobs: [
					slug as string,
					url as string,
					cfProperties.city as string,
					cfProperties.country as string,
					cfProperties.continent as string,
					cfProperties.region as string,
					cfProperties.regionCode as string,
					cfProperties.timezone as string,
				],
				doubles: [cfProperties.metroCode as number, cfProperties.longitude as number, cfProperties.latitude as number],
				indexes: [slug as string],
			});
		} else {
			console.warn(`TRACKER not defined (does not work on local dev), passing through ${slug} to ${url}`);
		}
	}
	// Redirect
	return c.redirect(url);
});

export default app;
