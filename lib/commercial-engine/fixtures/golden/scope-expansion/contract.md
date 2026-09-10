# Master Services Agreement — Statement of Work #1
**Client**: Acme Corporation  
**Provider**: Apex Digital Engineering Ltd.  
**Effective Date**: September 1, 2026  
**Document Version**: doc_v1_2026_09_01  
**Baseline Version**: baseline_v1_acme_core  

## §4.0 Technical Scope & Deliverables

### §4.1 System Infrastructure & Deployment
Core cloud hosting architecture on AWS ECS, PostgreSQL database clustering, automated CI/CD deployment pipelines, and operational monitoring.

### §4.2 User Authentication & Account Management
Delivery of end-user single-tenant authentication subsystem including:
- Email and password registration and login flows
- Session handling with JWT and HTTP-only cookies
- Password reset and email verification workflows
- Basic user profile management

**Explicit Inclusions**:
- End-user authentication
- Password hashing using Argon2id
- Standard session termination and revocation

**Explicit Exclusions**:
- Multi-tenant organization RBAC (Role-Based Access Control)
- Custom tenant roles and granular permission matrices
- Team invitations and enterprise member provisioning
- Single Sign-On (SSO) / SAML 2.0 / Okta integration
- SCIM directory synchronization

### §4.3 Analytics & Reporting
Standard analytics dashboard displaying user signups, daily active sessions, and core system throughput.
Export formats supported: JSON summary metrics.
