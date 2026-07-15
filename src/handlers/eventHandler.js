import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadEvents(client) {
  const files = readdirSync(__dirname + '/../events').filter(f => f.endsWith('.js'));
  
  for (const file of files) {
    const { default: event } = await import(`../events/${file}`);
    
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
    
    console.log(`Loaded event: ${event.name}`);
  }
}
