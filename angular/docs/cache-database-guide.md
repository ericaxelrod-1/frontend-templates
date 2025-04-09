# Permission Cache Database Guide

## Overview

The Angular Template Application implements a performance-optimized permission caching system that uses SQLite as a local cache database. This guide explains how the cache system works, how to manage it, and how to troubleshoot common issues.

## Purpose

The permission cache database serves several key purposes:

1. **Performance Optimization**: By caching permission data in a local SQLite database, we significantly reduce the load on the main database and improve response times for permission checks.

2. **Reduced Latency**: Instead of making complex permission resolution queries to the main database for every request, the application can quickly check the denormalized cache data.

3. **Optimized Data Structure**: The cache database uses a flattened data structure optimized for quick permission lookups.

## Architecture

### Cache Database Structure

The cache database consists of several tables:

1. **`cache_components`**: Stores UI component metadata and permission requirements
2. **`cache_routes`**: Stores route information and permission requirements
3. **`cache_endpoints`**: Stores API endpoint information and permission requirements
4. **`cache_permission_maps`**: Stores denormalized permission mappings for quick lookups
5. **`cache_sync_status`**: Tracks synchronization status between the main database and cache

### Synchronization Process

The cache database is kept in sync with the main database through these mechanisms:

1. **Startup Sync**: The cache is synchronized when the application starts
2. **Scheduled Sync**: A background job runs every 5 minutes to update the cache
3. **Manual Sync**: Administrators can trigger a manual sync through the admin interface
4. **Event-Based Sync**: When permissions are modified, the cache is automatically updated

## Administration

### Monitoring Cache Status

Administrators can monitor the cache status through the API:

```
GET /permissions/cache/status
```

This endpoint returns information about the last synchronization, including:
- Timestamp of the last sync
- Success/failure status
- Sync statistics (added, updated, deleted records)
- Error messages (if any)

### Forcing Synchronization

If needed, administrators can force a full synchronization:

```
POST /permissions/cache/sync
```

This is useful when:
- Permission data has been modified directly in the database
- You suspect the cache is out of sync
- After making significant changes to roles or permissions

### Cache Location

The SQLite cache database is stored at:

```
/path/to/app/cache/permissions.sqlite
```

This file can be backed up, but should not be manually edited. It is regenerated automatically by the application.

## Troubleshooting

### Common Issues

1. **Permissions Not Updating**: If permission changes don't seem to take effect, try forcing a manual sync.

2. **Performance Degradation**: If the application is slow to check permissions, ensure the cache synchronization is working properly.

3. **Database Lock Errors**: SQLite can encounter locking issues if multiple processes try to write to it simultaneously. The application has built-in retry mechanisms, but in rare cases you may need to restart the application.

### Logging

The cache synchronization process logs detailed information about its operations:

```
[CacheSyncService] Initializing permission cache database...
[CacheSyncService] Starting full synchronization...
[CacheSyncService] Synchronizing permissions...
[CacheSyncService] Synchronized 45 permission maps.
[CacheSyncService] Synchronizing role permissions...
[CacheSyncService] Synchronized 120 role permission maps.
[CacheSyncService] Synchronizing group permissions...
[CacheSyncService] Synchronized 85 group permission maps.
[CacheSyncService] Synchronizing user permissions...
[CacheSyncService] Synchronized 32 user permission maps.
[CacheSyncService] Full synchronization completed successfully.
```

Check these logs if you suspect issues with the cache synchronization.

### Manual Reset

In extreme cases, you can reset the cache by:

1. Stopping the application
2. Deleting the cache/permissions.sqlite file
3. Restarting the application

The cache will be completely rebuilt on startup.

## Performance Considerations

The cache database is designed for high performance, but there are some considerations:

1. **Initial Startup**: The first startup after deployment may take longer as the cache is being built
2. **Memory Usage**: The cache uses SQLite's in-memory mode for better performance, which uses additional memory
3. **Disk Space**: The cache database typically requires 10-20MB of disk space

## Security Implications

The cache database contains a copy of permission data, so it's important to secure it:

1. The database file should have appropriate file permissions
2. The cache API endpoints are protected with the `permissions:cache:view` and `permissions:cache:sync` permissions
3. The cache database does not contain sensitive user data, only permission mappings

## Future Enhancements

Planned improvements to the caching system:

1. Redis-based caching option for distributed deployments
2. More granular synchronization (sync only changed data)
3. Performance metrics and monitoring
4. Cache warmup process for faster application startup 