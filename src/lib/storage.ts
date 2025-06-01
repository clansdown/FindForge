import { Config } from './types';

const STORAGE_KEY = 'appConfig';

export function saveConfig(config: Config): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function loadConfig(): Config {
  const saved = localStorage.getItem(STORAGE_KEY);
  const config = new Config();
  
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      Object.assign(config, parsed);
    } catch (e) {
      console.error('Failed to parse saved config', e);
    }
  }
  
  return config;
}
