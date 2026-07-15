import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Collection } from 'discord.js';
import { prisma } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadCommands(client) {
  const folders = readdirSync(__dirname + '/../commands');
  
  for (const folder of folders) {
    const files = readdirSync(__dirname + `/../commands/${folder}`).filter(f => f.endsWith('.js'));
    
    for (const file of files) {
      const { default: command } = await import(`../commands/${folder}/${file}`);
      
      if (command.data) {
        client.slashCommands.set(command.data.name, command);
        console.log(`Loaded slash command: ${command.data.name}`);
      }
      
      if (command.prefix) {
        client.commands.set(command.name, command);
        console.log(`Loaded prefix command: ${command.name}`);
      }
    }
  }
}
