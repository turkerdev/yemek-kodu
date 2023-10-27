import { Redis } from '@upstash/redis/cloudflare';
import * as cheerio from 'cheerio';
import { Hono } from 'hono';
import chunk from 'lodash.chunk';

type Env = {
	UPSTASH_REDIS_REST_URL: string;
	UPSTASH_REDIS_REST_TOKEN: string;
	DISCORD_WEBHOOK: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
	const dom = await fetch('https://www.technopat.net/sosyal/bolum/indirim-koesesi.257/?prefix_id=30');
	const $ = cheerio.load(await dom.text());
	const posts = $('.js-threadList').children('div');
	const titles = posts.find('a[data-tp-primary="on"]');
	const sales = titles.toArray().map((title) => {
		return {
			title: $(title).text(),
			url: 'https://technopat.net' + $(title).attr('href'),
		};
	});

	const redis = Redis.fromEnv(c.env);
	const stored = await redis.smismember(
		'technopat/yemek',
		sales.map((sale) => sale.url)
	);

	const hot = stored
		.map((result, index) => {
			if (result === 1) return;
			if (!sales[index].title.toLowerCase().includes('yemek')) return;
			return sales[index];
		})
		.filter(Boolean);

	if (hot.length === 0) {
		return new Response('no new sales');
	}

	console.log('new sales', hot.length);

	const hooks = chunk(hot, 10).map((chunked) => {
		return fetch(c.env.DISCORD_WEBHOOK, {
			body: JSON.stringify({
				embeds: chunked.map((sale) => ({
					title: sale?.title,
					url: sale?.url,
				})),
			}),
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
		});
	});

	await Promise.all(hooks);
	await redis.sadd('technopat/yemek', ...hot.map((sale) => sale?.url));

	return new Response(JSON.stringify(hot));
});

export default app;
