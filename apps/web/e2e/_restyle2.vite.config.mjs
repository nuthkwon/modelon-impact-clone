// Temporary dev config for the restyle visual check: proxies the API to the scratch server on 8094.
import base from '../vite.config.ts';
const proxy = { '/api': { target: 'http://localhost:8094', changeOrigin: true }, '/libraries': { target: 'http://localhost:8094', changeOrigin: true } };
export default { ...base, server: { ...base.server, port: 5184, proxy } };
