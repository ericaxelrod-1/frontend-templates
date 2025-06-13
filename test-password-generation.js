const patterns = ['123456', 'password', 'qwerty', 'admin', '12345678', 'welcome', 'abcdef', 'abc123'];

// Simulate password generation
function generatePassword(length = 12) {
  const upperCaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowerCaseChars = 'abcdefghijklmnopqrstuvwxyz';
  const numberChars = '0123456789';
  const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  let charSet = upperCaseChars + lowerCaseChars + numberChars + specialChars;
  let requiredChars = '';
  
  // Ensure at least one of each type
  requiredChars += upperCaseChars.charAt(Math.floor(Math.random() * upperCaseChars.length));
  requiredChars += lowerCaseChars.charAt(Math.floor(Math.random() * lowerCaseChars.length));
  requiredChars += numberChars.charAt(Math.floor(Math.random() * numberChars.length));
  requiredChars += specialChars.charAt(Math.floor(Math.random() * specialChars.length));
  
  // Generate remaining characters
  let password = requiredChars;
  for (let i = requiredChars.length; i < length; i++) {
    password += charSet.charAt(Math.floor(Math.random() * charSet.length));
  }
  
  // Shuffle
  const arr = password.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

// Test password generation
console.log('Testing password generation...');
for (let i = 0; i < 20; i++) {
  const password = generatePassword(12);
  const hasCommonPattern = patterns.some(pattern => password.toLowerCase().includes(pattern));
  console.log(`Password ${i+1}: ${password} - Contains common pattern: ${hasCommonPattern}`);
}

// Test specific patterns that might be problematic
console.log('\nTesting for specific pattern occurrences:');
const testPasswords = [];
for (let i = 0; i < 100; i++) {
  testPasswords.push(generatePassword(12));
}

patterns.forEach(pattern => {
  const count = testPasswords.filter(pwd => pwd.toLowerCase().includes(pattern)).length;
  console.log(`Pattern "${pattern}" found in ${count}/100 generated passwords`);
}); 