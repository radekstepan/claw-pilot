import Fastify from 'fastify';

const fastify = Fastify({ logger: true });

fastify.get('/', async (request, reply) => {
    return { status: 'ClawController Gateway API Nominal' };
});

const start = async () => {
    try {
        await fastify.listen({ port: 54321, host: '0.0.0.0' });
        console.log('Server listening on http://localhost:54321');
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
