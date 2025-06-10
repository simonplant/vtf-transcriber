const fs = require('fs');
const path = require('path');

function validateExtension() {
  const distPath = path.join(__dirname, '..', 'dist');
  
  // Check if dist directory exists
  if (!fs.existsSync(distPath)) {
    console.error('❌ dist directory not found. Run build first.');
    process.exit(1);
  }

  // Required files
  const requiredFiles = [
    'manifest.json',
    'background.js',
    'options.html',
    'options.bundle.js',
    'popup.html',
    'popup.bundle.js',
    'content.bundle.js',
    'audio-worklet.js'
  ];

  // Check each required file
  const missingFiles = requiredFiles.filter(file => 
    !fs.existsSync(path.join(distPath, file))
  );

  if (missingFiles.length > 0) {
    console.error('❌ Missing required files:', missingFiles.join(', '));
    process.exit(1);
  }

  // Validate manifest.json
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf8')
    );
    
    // Check required manifest fields
    const requiredFields = ['name', 'version', 'manifest_version', 'permissions'];
    const missingFields = requiredFields.filter(field => !manifest[field]);
    
    if (missingFields.length > 0) {
      console.error('❌ Missing required manifest fields:', missingFields.join(', '));
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Invalid manifest.json:', error.message);
    process.exit(1);
  }

  console.log('✅ Extension validation passed!');
}

validateExtension(); 