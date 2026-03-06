import {
    animate,
    state,
    style,
    transition,
    trigger,
    AnimationTriggerMetadata
} from '@angular/animations';

/**
 * Animation for side panel slide-in/slide-out.
 *
 * Usage in a component:
 * @Component({
 *   animations: [sidePanelAnimations.sidePanelSlide],
 *   template: `<div [@sidePanelSlide]="animationState">...</div>`
 * })
 */
export const sidePanelAnimations: {
    readonly sidePanelSlide: AnimationTriggerMetadata;
} = {
    sidePanelSlide: trigger('sidePanelSlide', [
        state('void', style({ transform: 'translateX(100%)' })),
        state('enter', style({ transform: 'translateX(0)' })),
        state('exit', style({ transform: 'translateX(100%)' })),
        transition('void => enter', animate('300ms ease-out')),
        transition('enter => exit', animate('200ms ease-in')),
        transition('enter => void', animate('200ms ease-in'))
    ])
};
