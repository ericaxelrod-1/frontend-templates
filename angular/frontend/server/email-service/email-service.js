/**
 * Email Service
 * 
 * This module provides functionality for sending emails using Nodemailer.
 * It supports both development (using MailDev) and production environments.
 */

const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const emailConfig = require('./config/email-config');
const { logger } = require('./config/debug-config');

// Create a reusable transporter object using the configuration
const transporter = nodemailer.createTransport(
  emailConfig.transport,
  emailConfig.defaults
);

// Simple security checks for email
const validateEmail = (email) => {
  // Check for null or empty email
  if (!email || typeof email !== 'string') {
    throw new Error('Invalid email format');
  }
  
  // Email must not have leading or trailing spaces
  const trimmedEmail = email.trim();
  if (trimmedEmail !== email) {
    throw new Error('Email contains leading or trailing spaces');
  }
  
  // Comprehensive email format validation
  // This regex checks for most of the RFC 5322 requirements
  const emailRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]{0,61}[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }
  
  // Check for multiple dots in local part
  const localPart = email.split('@')[0];
  if (localPart.includes('..')) {
    throw new Error('Email contains consecutive dots');
  }
  
  // Check for leading or trailing dots in local part
  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    throw new Error('Email local part cannot start or end with a dot');
  }
  
  // Check for common spam domains or disposable email domains
  const blockedDomains = [
    'tempmail.com', 'fakeinbox.com', 'guerrillamail.com', 
    'mailinator.com', 'spam4.me', 'yopmail.com', 'spam.com'
  ];
  
  const domain = email.split('@')[1].toLowerCase();
  if (blockedDomains.includes(domain)) {
    throw new Error('Email domain not allowed');
  }
  
  return true;
};

// Sanitize template context to prevent XSS in emails
const sanitizeContext = (context) => {
  // Return empty object for null input
  if (!context || typeof context !== 'object') {
    return {};
  }
  
  const sanitized = {};
  
  for (const [key, value] of Object.entries(context)) {
    // Skip special properties that could lead to prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      sanitized[key] = '';
      continue;
    }
    
    if (typeof value === 'string') {
      // Enhanced sanitization
      let sanitizedValue = value
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\$/g, '&#036;')
        .replace(/{/g, '&#123;')
        .replace(/}/g, '&#125;');
      
      // Block javascript: URLs
      if (/^javascript:/i.test(sanitizedValue)) {
        sanitizedValue = '';
      }
      
      sanitized[key] = sanitizedValue;
    } else if (value === null || value === undefined) {
      sanitized[key] = '';
    } else if (typeof value === 'object') {
      // Recursively sanitize objects, but not arrays or functions
      if (!Array.isArray(value) && value !== null) {
        sanitized[key] = sanitizeContext(value);
      } else {
        // For arrays, convert to string to prevent injections
        sanitized[key] = JSON.stringify(value);
      }
    } else {
      // For other types (number, boolean), convert to string
      sanitized[key] = String(value);
    }
  }
  
  return sanitized;
};

// Simple template engine for email templates
const renderTemplate = (templateName, context) => {
  // Ensure template name doesn't include path traversal
  if (templateName.includes('..') || templateName.includes('/') || templateName.includes('\\')) {
    throw new Error('Invalid template name');
  }
  
  const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
  
  try {
    let template = fs.readFileSync(templatePath, 'utf8');
    
    // Replace variables in the template with sanitized values
    const sanitizedContext = sanitizeContext(context);
    Object.keys(sanitizedContext).forEach(key => {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      template = template.replace(regex, sanitizedContext[key]);
    });
    
    return template;
  } catch (error) {
    console.error(`Error loading template ${templateName}:`, error);
    return null;
  }
};

/**
 * Send an email
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text email content
 * @param {string} options.html - HTML email content (optional)
 * @param {string} options.template - Template name (optional)
 * @param {Object} options.context - Template context (optional)
 * @returns {Promise} - Promise resolving to the sent message info
 */
const sendEmail = async (options) => {
  try {
    // Validate recipient email
    if (!options.to || !validateEmail(options.to)) {
      throw new Error('Invalid recipient email');
    }
    
    // Validate subject (prevent header injection)
    if (!options.subject || options.subject.includes('\r') || options.subject.includes('\n')) {
      throw new Error('Invalid email subject');
    }
    
    // If template is specified, render it
    if (options.template && options.context) {
      options.html = renderTemplate(options.template, options.context);
      
      // Generate plain text version if no text provided
      if (!options.text) {
        // Very simple HTML to text conversion
        options.text = options.html
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    
    // Send mail with defined transport object
    const info = await transporter.sendMail({
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html
    });
    
    if (emailConfig.debug) {
      console.log('Email sent: %s', info.messageId);
      
      if (emailConfig.environment === 'development') {
        console.log('MailDev preview URL: http://localhost:%s', emailConfig.mailDevUI.port);
      }
    }
    
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

/**
 * Send password reset email
 * @param {string} email - User's email address
 * @param {string} resetToken - Password reset token
 * @param {string} resetUrl - Password reset URL
 * @returns {Promise} - Promise resolving to the sent message info
 */
const sendPasswordResetEmail = async (email, resetToken, resetUrl) => {
  // Validate inputs
  if (!email || !resetToken) {
    throw new Error('Email and resetToken are required');
  }
  
  if (!validateEmail(email)) {
    throw new Error('Invalid email format');
  }
  
  return sendEmail({
    to: email,
    subject: 'Password Reset',
    template: 'password-reset',
    context: {
      resetUrl: resetUrl || `http://localhost:4200/reset-password?token=${resetToken}`,
      token: resetToken
    }
  });
};

// Verify connection configuration
transporter.verify()
  .then(() => {
    console.log('Email service ready to send messages');
  })
  .catch(error => {
    console.error('Email service configuration error:', error);
  });

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
  validateEmail,
  sanitizeContext
}; 