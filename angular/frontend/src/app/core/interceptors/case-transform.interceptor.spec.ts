import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HTTP_INTERCEPTORS, HttpClient } from '@angular/common/http';
import { CaseTransformInterceptor } from './case-transform.interceptor';
import { environment } from '../../../environments/environment';

describe('CaseTransformInterceptor', () => {
  let httpClient: HttpClient;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: HTTP_INTERCEPTORS,
          useClass: CaseTransformInterceptor,
          multi: true
        }
      ]
    });

    httpClient = TestBed.inject(HttpClient);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should transform snake_case keys to camelCase in API responses', () => {
    const mockResponse = {
      access_token: 'test-token',
      refresh_token: 'refresh-token',
      csrf_token: 'csrf-token',
      expires_in: 3600,
      user: {
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
        is_active: true,
        user_permissions: [
          {
            resource_name: 'users',
            action_name: 'read'
          }
        ]
      }
    };

    const expectedResponse = {
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
      csrfToken: 'csrf-token',
      expiresIn: 3600,
      user: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        isActive: true,
        userPermissions: [
          {
            resourceName: 'users',
            actionName: 'read'
          }
        ]
      }
    };

    // Make an HTTP request
    httpClient.get(`${environment.apiUrl}/auth/login`).subscribe(response => {
      // Verify the response has been transformed
      expect(response).toEqual(expectedResponse);
    });

    // Expect one request to the URL and respond with mock data
    const req = httpTestingController.expectOne(`${environment.apiUrl}/auth/login`);
    req.flush(mockResponse);
  });

  it('should not transform non-API responses', () => {
    const mockResponse = { test_value: 'test' };

    // Make an HTTP request to a non-API endpoint
    httpClient.get('https://example.com/some-external-api').subscribe(response => {
      // Verify the response has NOT been transformed
      expect(response).toEqual(mockResponse);
    });

    // Expect one request to the URL and respond with mock data
    const req = httpTestingController.expectOne('https://example.com/some-external-api');
    req.flush(mockResponse);
  });

  it('should handle null and undefined values', () => {
    const mockResponse = {
      data: null,
      empty_array: [],
      nested: {
        null_value: null
      }
    };

    const expectedResponse = {
      data: null,
      emptyArray: [],
      nested: {
        nullValue: null
      }
    };

    // Make an HTTP request
    httpClient.get(`${environment.apiUrl}/data`).subscribe(response => {
      // Verify the response has been transformed
      expect(response).toEqual(expectedResponse);
    });

    // Expect one request to the URL and respond with mock data
    const req = httpTestingController.expectOne(`${environment.apiUrl}/data`);
    req.flush(mockResponse);
  });

  it('should handle deeply nested objects and arrays', () => {
    const mockResponse = {
      items: [
        {
          item_name: 'Item 1',
          item_details: {
            created_at: '2023-01-01',
            updated_at: '2023-01-02',
            nested_array: [
              {
                nested_item_id: 1,
                nested_item_name: 'Nested Item 1'
              }
            ]
          }
        }
      ]
    };

    const expectedResponse = {
      items: [
        {
          itemName: 'Item 1',
          itemDetails: {
            createdAt: '2023-01-01',
            updatedAt: '2023-01-02',
            nestedArray: [
              {
                nestedItemId: 1,
                nestedItemName: 'Nested Item 1'
              }
            ]
          }
        }
      ]
    };

    // Make an HTTP request
    httpClient.get(`${environment.apiUrl}/items`).subscribe(response => {
      // Verify the response has been transformed
      expect(response).toEqual(expectedResponse);
    });

    // Expect one request to the URL and respond with mock data
    const req = httpTestingController.expectOne(`${environment.apiUrl}/items`);
    req.flush(mockResponse);
  });
}); 