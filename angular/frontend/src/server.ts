import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr';
import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bootstrap from './main.server';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const app = express();
const commonEngine = new CommonEngine();

// Middleware to parse JSON bodies with size limits
app.use(express.json({ limit: '100kb' }));

// Security headers
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // XSS Protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

/**
 * API Routes for Authentication Services
 */
// Initialize a temporary storage for reset tokens (in a real app, use a database)
const resetTokens = new Map();
// Keep track of email requests to prevent abuse
const emailAttempts = new Map();

// Rate limiter for password reset requests - 5 requests per hour per IP
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per windowMs
  message: { success: false, message: 'Too many password reset requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Generate a secure random token
const generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

// Helper to check if email is valid
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return typeof email === 'string' && emailRegex.test(email);
};

// Rate tracking for individual emails - limit to 3 requests per email per day
const trackEmailAttempt = (email: string): boolean => {
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  // Get existing attempts or initialize new array
  const attempts = emailAttempts.get(email) || [];
  
  // Filter out attempts older than 24 hours
  const recentAttempts = attempts.filter((timestamp: number) => timestamp > oneDayAgo);
  
  // Add current attempt
  recentAttempts.push(now);
  
  // Update the map
  emailAttempts.set(email, recentAttempts);
  
  // Check if we've exceeded the limit
  return recentAttempts.length <= 3;
};

// Password reset request endpoint with rate limiting
app.post('/api/auth/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }

    // Check per-email rate limit
    if (!trackEmailAttempt(email)) {
      // Don't expose that we're tracking attempts
      return res.json({
        success: true,
        message: 'If your email is registered, you will receive a password reset link'
      });
    }

    // In a real app, check if the email exists in your database
    // For security, don't reveal if the email exists or not
    // const userExists = await checkUserExists(email);
    // if (!userExists) {
    //   // Still return success to avoid user enumeration
    //   return res.json({
    //     success: true,
    //     message: 'If your email is registered, you will receive a password reset link'
    //   });
    // }

    // Generate a reset token
    const resetToken = generateToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour (reduced from 24)

    // Store the token
    resetTokens.set(resetToken, {
      email,
      expiresAt,
      attempts: 0 // Track validation attempts
    });

    try {
      // Dynamic import of email service (ESM/CommonJS compatibility)
      // @ts-ignore - Ignore the lack of type definitions for the dynamically imported module
      const emailService = await import('../server/email-service/email-service.js');
      
      // Send the reset email
      await emailService.sendPasswordResetEmail(
        email,
        resetToken,
        `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`
      );

      // Always return the same message whether email exists or not
      return res.json({
        success: true,
        message: 'If your email is registered, you will receive a password reset link'
      });
    } catch (importError) {
      console.error('Error importing email service:', importError);
      return res.status(500).json({
        success: false,
        message: 'Server error, please try again later'
      });
    }
  } catch (error) {
    console.error('Password reset error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error, please try again later'
    });
  }
});

// Rate limiter for token verification - 10 attempts per hour per IP
const tokenVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 requests per windowMs
  message: { success: false, message: 'Too many verification attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Verify reset token endpoint
app.post('/api/auth/verify-reset-token', tokenVerifyLimiter, (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, message: 'Valid token is required' });
    }

    const tokenData = resetTokens.get(token);
    if (!tokenData) {
      return res.status(400).json({ success: false, message: 'Invalid token' });
    }

    // Increment attempt counter to prevent brute force
    tokenData.attempts = (tokenData.attempts || 0) + 1;
    
    // Invalidate token after too many attempts
    if (tokenData.attempts > 5) {
      resetTokens.delete(token);
      return res.status(400).json({ success: false, message: 'Token has been invalidated due to too many attempts' });
    }

    if (new Date() > tokenData.expiresAt) {
      resetTokens.delete(token);
      return res.status(400).json({ success: false, message: 'Token has expired' });
    }

    return res.json({
      success: true,
      message: 'Token is valid',
      email: tokenData.email
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error, please try again later' 
    });
  }
});

// Rate limiter for password reset - 3 attempts per hour per IP
const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per windowMs
  message: { success: false, message: 'Too many reset attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Reset password endpoint
app.post('/api/auth/reset-password', resetPasswordLimiter, (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    // Validate inputs
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid token is required' 
      });
    }
    
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 8 characters long' 
      });
    }

    const tokenData = resetTokens.get(token);
    if (!tokenData) {
      return res.status(400).json({ success: false, message: 'Invalid token' });
    }

    if (new Date() > tokenData.expiresAt) {
      resetTokens.delete(token);
      return res.status(400).json({ success: false, message: 'Token has expired' });
    }

    // In a real app, update the user's password in your database
    // For now, just respond with success
    
    // Clean up the used token - single use only
    resetTokens.delete(token);

    return res.json({
      success: true,
      message: 'Password has been reset successfully'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error, please try again later' 
    });
  }
});

// Purge expired tokens periodically
setInterval(() => {
  const now = new Date();
  for (const [token, data] of resetTokens.entries()) {
    if (now > data.expiresAt) {
      resetTokens.delete(token);
    }
  }
}, 15 * 60 * 1000); // Run every 15 minutes

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/**', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.get(
  '**',
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: 'index.html'
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.get('*', (req: express.Request, res: express.Response) => {
  const { protocol, originalUrl, baseUrl, headers } = req;

  commonEngine
    .render({
      bootstrap,
      documentFilePath: indexHtml,
      url: `${protocol}://${headers.host}${originalUrl}`,
      publicPath: browserDistFolder,
      providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
    })
    .then((html: string) => res.send(html))
    .catch((err: Error) => {
      console.error(err);
      res.status(500).send('Server error');
    });
});

// Start the server
const port = process.env['PORT'] || 4000;
app.listen(port, () => {
  console.log(`Node Express server listening on http://localhost:${port}`);
});

export default app;
