# STORY-002: Implementation Across Components

## Objective
Update primary application views to proactively publish their localized context to the `PageTitleService` upon navigation. 

## Requirements
- Target specific feature components such as `RolesComponent`, `GroupsComponent`, `DashboardComponent`, `UsersComponent`, `ProfileComponent`, etc.
- Upon `ngOnInit`, components must inject the service and call `setTitle()`.

## Tasks
* [TASK-001: Update Key Components](./TASK-001-update-components.md)
* [TASK-002: Remove Redundant Page Titles](./TASK-002-remove-redundant-titles.md)
