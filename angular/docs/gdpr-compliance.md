# GDPR Compliance Documentation

This document outlines how the Angular Template Application maintains compliance with the General Data Protection Regulation (GDPR) for users in the European Union.

## Overview

The GDPR is a regulation in EU law on data protection and privacy for individuals within the European Union and the European Economic Area. It addresses the transfer of personal data outside the EU and EEA areas.

This document outlines:
1. What personal data we collect
2. How we process this data
3. User rights regarding their data
4. Data deletion mechanisms
5. Future enhancements for compliance

## Personal Data Collection

The application currently collects the following personal information from users:

- Email address
- First name (optional)
- Last name (optional)
- Password (stored using secure hashing)
- User preferences (theme, language, notification settings)
- Authentication records (account creation, verification, last login)

## Data Processing

Personal data is processed for the following purposes:

1. User authentication and account management
2. Personalization of user experience
3. Group membership and permissions management
4. Communication regarding account status (e.g., verification emails)

## User Rights Under GDPR

Our application supports the following user rights:

1. **Right to be informed**: Users are informed about data collection during registration
2. **Right to access**: Users can view their profile information
3. **Right to rectification**: Users can update their personal information
4. **Right to erasure (right to be forgotten)**: Users can delete their account
5. **Right to restrict processing**: Currently limited, planned for future enhancement
6. **Right to data portability**: Currently limited, planned for future enhancement
7. **Right to object**: Currently limited, planned for future enhancement
8. **Rights related to automated decision-making**: Not applicable as we do not perform automated decision-making

## Account Deletion Implementation

The application implements a GDPR-compliant account deletion mechanism:

### What Happens When a User Deletes Their Account

When a user chooses to delete their account:

1. Personal identifiable information (PII) is removed:
   - Email address is nullified or anonymized
   - First and last name are removed

2. Account status is updated:
   - `userDeleted` flag is set to `true`
   - `deleteDate` timestamp is recorded

3. Data retention:
   - Non-PII data is retained for system integrity
   - Any content created by the user remains in the system but is disassociated from their identity

### Deletion Process

The deletion process is:

1. User initiates deletion through the profile menu
2. Confirmation modal appears explaining the consequences
3. User confirms deletion
4. Backend performs soft deletion (PII removal)
5. User is logged out and redirected to the login page
6. Confirmation email is sent (to the email on file before deletion)

### Irreversibility

Account deletion is irreversible. Users are clearly informed of this before confirming deletion.

## Future Enhancements

The following enhancements are planned for improved GDPR compliance:

1. **Data export functionality**:
   - Allow users to download all their personal data in a machine-readable format
   - Include all user-generated content in exports

2. **Enhanced data removal options**:
   - Provide options for removing user-generated content upon account deletion
   - Allow for selective data removal

3. **Improved consent management**:
   - Granular consent options for different types of data processing
   - Ability to withdraw consent for specific processing activities

4. **Data processing logs**:
   - Maintain detailed logs of all data processing activities
   - Provide transparency regarding how and when data is processed

5. **Automated data retention policies**:
   - Implement time-based data purging for inactive accounts
   - Apply retention policies based on data categories

## Conclusion

This GDPR compliance framework is designed to protect user rights while maintaining application functionality. As the application evolves, additional GDPR compliance measures will be implemented according to this roadmap.

The implementation of these measures ensures that users have control over their personal data and that the application processes this data in a transparent and compliant manner. 