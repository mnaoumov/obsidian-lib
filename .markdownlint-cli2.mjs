import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { config } = await jiti.import('./scripts/quality/markdownlint-cli2-config.ts');
export default config;
