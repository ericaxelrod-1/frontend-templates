# TASK-005: Add Groups Table Padding & Final Verification

## Objective
Apply the requested 5px inner top/bottom padding to the existing `groups-table` and verify the complete end-to-end functionality for both tables.

## Current State
The Groups `mat-table` layout may feel cramped without extra vertical padding. The Roles page refactor tasks have all been documented and hypothetically implemented as per previous task files.

## Desired State
`GroupsComponent` has spacious top and bottom inner padding for rows. The Roles layout perfectly mimics the Groups paginated component structure. Both pass TypeScript compilation and successfully navigate real-time filtering queries. 

## Steps
1. Append 5px top/bottom padding to `.groups-table` cells in `GroupsComponent`:
   ```css
   .groups-table .mat-cell,
   .groups-table .mat-header-cell {
     padding-top: 5px;
     padding-bottom: 5px;
   }
   ```
2. Re-run `npm run build` in respective `/frontend` and `/backend` directories.
3. Serve applications locally.
4. Verify the Groups table layout reflects the padded changes.
5. Verify the Roles table accurately fetches paginated payloads, properly sorting and searching roles in the UI.
