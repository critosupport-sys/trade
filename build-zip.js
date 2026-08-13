// Script to automatically package the project into a professional ZIP file
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const outputZipPath = path.join(__dirname, 'bot_project.zip');

function packageProject() {
  console.log('--- Starting ZIP Compilation ---');

  if (fs.existsSync(outputZipPath)) {
    fs.unlinkSync(outputZipPath);
    console.log('Deleted existing bot_project.zip');
  }

  const output = fs.createWriteStream(outputZipPath);
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  output.on('close', () => {
    console.log(`\nSUCCESS: ZIP file successfully generated!`);
    console.log(`Total Bytes: ${archive.pointer()}`);
    console.log(`Location: ${outputZipPath}`);
    console.log('--- ZIP Compilation Complete ---');
  });

  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      console.warn('Archiver Warning:', err);
    } else {
      throw err;
    }
  });

  archive.on('error', (err) => {
    throw err;
  });

  archive.pipe(output);

  const filesToAdd = [
    'package.json',
    '.gitignore',
    'strategies.js',
    'backtester.js',
    'live_trader.js',
    'server.js',
    'start.bat',
    'README.md',
    'HOW_TO_USE.md',
    'test-strategies.js',
    'test-backtester.js',
    'test-persistence.js',
    'backtest-june-july-2026.js'
  ];

  filesToAdd.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: file });
      console.log(`Added file: ${file}`);
    } else {
      console.warn(`Warning: Expected file ${file} was not found!`);
    }
  });

  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    archive.directory('public/', 'public');
    console.log('Added directory: public/');
  }

  archive.finalize();
}

packageProject();
