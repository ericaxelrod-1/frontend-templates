const axios = require('axios');

async function testUserCreation() {
  try {
    console.log('Testing user creation with new username field...');
    
    const userData = {
      username: 'testuser123',
      email: 'testuser123@example.com',
      firstName: 'Test',
      lastName: 'User',
      password: 'TestPassword123!',
      roleId: 1, // Assuming role ID 1 exists
      requiresPasswordChange: true
    };

    console.log('Sending user creation request:', {
      ...userData,
      password: '[HIDDEN]'
    });

    const response = await axios.post('http://localhost:3000/users', userData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('User created successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error creating user:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
    throw error;
  }
}

// Run the test
testUserCreation()
  .then(() => {
    console.log('Test completed successfully!');
    process.exit(0);
  })
  .catch(() => {
    console.log('Test failed!');
    process.exit(1);
  }); 