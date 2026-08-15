const DEFAULT_DASHBOARD_URL = 'https://killjoyshop-27gt.onrender.com';

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
}

export function getDashboardUrl() {
  return readEnv(
    'DASHBOARD_URL',
    'RENDER_EXTERNAL_URL',
    'RENDER_EXTERNAL_HOSTNAME',
    'PUBLIC_URL'
  ) || DEFAULT_DASHBOARD_URL;
}

export function getPushbulletToken() {
  return readEnv('PUSHBULLET_TOKEN', 'PUSHBULLET_ACCESS_TOKEN');
}
