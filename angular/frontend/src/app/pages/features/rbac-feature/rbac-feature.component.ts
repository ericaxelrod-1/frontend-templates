import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-rbac-feature',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatCardModule, RouterModule],
  templateUrl: './rbac-feature.component.html',
  styleUrls: ['./rbac-feature.component.scss']
})
export class RbacFeatureComponent {
  features = [
    {
      title: 'Solid Security Foundation',
      description: 'Built for agentic engineers and vibe coders. Start your on-prem deployment with a rock-solid base that handles the complexity of access control out of the box.',
      icon: 'foundation'
    },
    {
      title: 'Departmental Segregation',
      description: 'Keep internal data strictly within the teams that need it. Ensure HR, Finance, and Engineering operate without accidental cross-exposure.',
      icon: 'shield'
    },
    {
      title: 'Dynamic Organizational Hierarchy',
      description: 'Mirror any complex company structure. Permissions flow naturally from leadership to teams, allowing for effortless management during rapid scale.',
      icon: 'account_tree'
    },
    {
      title: 'The "Safety First" Override',
      description: 'An Explicit Deny system ensures that security always wins. Block access to critical resources with 100% certainty, overriding any other granted rules.',
      icon: 'gpp_forbidden'
    },
    {
      title: 'Audit-Safe Compliance',
      description: 'Maintain a perfect trail of system access. Satisfy even the most stringent compliance and safety requirements with automated event logging.',
      icon: 'policy'
    },
    {
      title: 'Centralized Governance',
      description: 'Restrict powerful capabilities to verified administrators. Prevent accidental system-wide changes and maintain a stable, secure foundation.',
      icon: 'admin_panel_settings'
    }
  ];
}
