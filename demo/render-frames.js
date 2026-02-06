const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read the cast file
const cast = fs.readFileSync('full-demo.cast', 'utf-8').split('\n');
const header = JSON.parse(cast[0]);

// Create frames directory
const framesDir = path.join(__dirname, 'frames');
if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir);

console.log(`Cast dimensions: ${header.width}x${header.height}`);
console.log(`Duration: ~${cast.length} events`);

// For now, just output the info
console.log('Use asciinema upload to share the recording:');
console.log('asciinema upload full-demo.cast');
