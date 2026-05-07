import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicFooterComponent } from './public-footer.component';
import { TestingModule } from '../../../tests/test-utils';

describe('PublicFooterComponent', () => {
  let component: PublicFooterComponent;
  let fixture: ComponentFixture<PublicFooterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicFooterComponent, TestingModule]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PublicFooterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
