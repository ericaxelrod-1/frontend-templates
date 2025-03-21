# Cursor Rule Examples

This guide provides real-world examples of different types of Cursor rules for various purposes and technologies.

## Table of Contents

- [Project Information](#project-information)
- [Language-Specific Rules](#language-specific-rules)
- [Framework-Specific Rules](#framework-specific-rules)
- [Component Rules](#component-rules)
- [Testing Rules](#testing-rules)
- [API and Service Rules](#api-and-service-rules)
- [Documentation Rules](#documentation-rules)
- [Workflow Rules](#workflow-rules)

## Project Information

### 000-project-info.mdc

```
---
description: "Core project information for a React TypeScript application"
globs: [".cursor/rules/*.mdc"]
tags: ["project", "meta"]
priority: 5
---

# MyApp Project Information

## Project Overview

MyApp is a modern web application for task management, built with React, TypeScript, and a RESTful API backend.

## Architecture

- **Frontend**: React with TypeScript
- **State Management**: Redux Toolkit
- **API Communication**: Axios with custom interceptors
- **UI Components**: Custom design system based on Material UI
- **Routing**: React Router v6

## Key Conventions

- All components are functional components with hooks
- State management follows the Redux slice pattern
- API calls are centralized in service files
- Error handling follows a centralized pattern
- Styling uses CSS modules with SCSS
```

## Language-Specific Rules

### 100-typescript.mdc

```
---
description: "TypeScript standards and best practices"
globs: ["src/**/*.ts", "src/**/*.tsx"]
tags: ["typescript", "language"]
priority: 4
---

# TypeScript Standards

@projectinfo.mdc

## Type Definitions

### Use Explicit Types

<example language="typescript">
// Good: Explicit type annotations
const calculateTotal = (items: CartItem[]): number => {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
};

// Bad: Relying on type inference for complex functions
const calculateTotal = (items) => {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
};
</example>

### Prefer Interfaces for Object Types

<example language="typescript">
// Good: Using interfaces for object types
interface User {
  id: string;
  name: string;
  email: string;
  preferences?: UserPreferences;
}

// Less preferred: Using type aliases for simple object types
type User = {
  id: string;
  name: string;
  email: string;
  preferences?: UserPreferences;
};
</example>

## Null Handling

### Use Undefined for Optional Values

<example language="typescript">
// Good: Using undefined for absent values
interface User {
  middleName?: string; // undefined if not present
}

// Bad: Using null for absent values
interface User {
  middleName: string | null; // null if not present
}
</example>

## Function Types

### Use Arrow Functions for Inline Callbacks

<example language="typescript">
// Good: Arrow function for callback
items.map((item) => transformItem(item));

// Less preferred: Function expression
items.map(function(item) { return transformItem(item); });
</example>
```

## Framework-Specific Rules

### 200-react.mdc

```
---
description: "React component standards and best practices"
globs: ["src/**/*.tsx", "src/**/*.jsx"]
tags: ["react", "components"]
priority: 4
---

# React Standards

@projectinfo.mdc

## Component Structure

### Use Functional Components

<example language="tsx">
// Good: Functional component with hooks
import React, { useState } from 'react';

interface ButtonProps {
  label: string;
  onClick: () => void;
}

export const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={isHovered ? 'btn btn-hover' : 'btn'}
    >
      {label}
    </button>
  );
};
</example>

### Export Named Components

<example language="tsx">
// Good: Named export
export const UserProfile: React.FC<UserProfileProps> = (props) => {
  // ...
};

// Bad: Default export
const UserProfile: React.FC<UserProfileProps> = (props) => {
  // ...
};

export default UserProfile;
</example>

## Hooks Usage

### Custom Hook Naming

All custom hooks should:
- Start with "use" prefix
- Be camelCase
- Describe their purpose clearly

<example language="tsx">
// Good: Descriptive hook name with "use" prefix
function useUserAuthentication(userId: string) {
  // ...
}

// Bad: Missing "use" prefix or unclear purpose
function authentication(userId: string) {
  // ...
}
</example>

### Avoid Complex useEffect Dependencies

<example language="tsx">
// Good: Simple dependencies
useEffect(() => {
  fetchUserData(userId);
}, [userId]);

// Bad: Object or function dependencies that may cause unnecessary re-renders
useEffect(() => {
  fetchUserData(userObject);
}, [userObject]); // userObject will cause effect to run on every render
</example>
```

### 210-redux.mdc

```
---
description: "Redux state management patterns"
globs: ["src/store/**/*.ts", "src/store/**/*.tsx"]
tags: ["redux", "state"]
priority: 3
---

# Redux State Management Standards

@projectinfo.mdc

## Slice Pattern

### Slice Structure

Each slice should contain:
- State interface
- Initial state
- Reducers
- Thunks (if needed)
- Selectors

<example language="typescript">
// src/store/slices/userSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UserState {
  currentUser: User | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: UserState = {
  currentUser: null,
  isLoading: false,
  error: null,
};

export const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<User>) => {
      state.currentUser = action.payload;
      state.error = null;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.isLoading = false;
    },
    clearUser: (state) => {
      state.currentUser = null;
    },
  },
});

// Export actions
export const { setUser, setLoading, setError, clearUser } = userSlice.actions;

// Export selectors
export const selectCurrentUser = (state: RootState) => state.user.currentUser;
export const selectIsLoading = (state: RootState) => state.user.isLoading;
export const selectError = (state: RootState) => state.user.error;

// Export reducer
export default userSlice.reducer;
</example>

## Async Operations

### Thunk Pattern

<example language="typescript">
// src/store/slices/userThunks.ts
import { createAsyncThunk } from '@reduxjs/toolkit';
import { userApi } from '../../services/userApi';
import { setLoading, setUser, setError } from './userSlice';

export const fetchUser = createAsyncThunk(
  'user/fetchUser',
  async (userId: string, { dispatch }) => {
    try {
      dispatch(setLoading(true));
      const user = await userApi.getUser(userId);
      dispatch(setUser(user));
      return user;
    } catch (error) {
      dispatch(setError(error.message));
      throw error;
    } finally {
      dispatch(setLoading(false));
    }
  }
);
</example>
```

## Component Rules

### component-button.mdc

```
---
description: "Button component standards and usage"
globs: ["src/components/Button/**/*.tsx", "src/components/ui/Button/**/*.tsx"]
tags: ["components", "button", "ui"]
priority: 3
---

# Button Component Standards

@projectinfo.mdc

## Usage Guidelines

Buttons should:
- Have clear, concise labels
- Indicate their purpose through visual styling
- Be consistently sized within the same view
- Have appropriate spacing around them

## Button Variants

The application uses the following button variants:

1. **Primary Button**: For main actions on a page
2. **Secondary Button**: For alternative actions
3. **Tertiary Button**: For less important actions
4. **Danger Button**: For destructive actions
5. **Ghost Button**: For the least important actions, often in toolbars

<example language="tsx">
// Primary button example
<Button variant="primary" onClick={handleSubmit}>
  Submit
</Button>

// Secondary button example
<Button variant="secondary" onClick={handleCancel}>
  Cancel
</Button>

// Danger button example
<Button variant="danger" onClick={handleDelete}>
  Delete Account
</Button>
</example>

## Button Sizes

Buttons come in three standard sizes:

1. **Small**: For tight spaces or inline actions
2. **Medium**: Default size for most cases
3. **Large**: For emphasized actions

<example language="tsx">
<Button size="small">Small</Button>
<Button size="medium">Medium</Button>
<Button size="large">Large</Button>
</example>

## State Indication

Buttons should clearly indicate their state:

1. **Loading**: Show a spinner when the action is processing
2. **Disabled**: Visually indicate when a button is not available
3. **Focus**: Show a focus ring when the button is focused via keyboard

<example language="tsx">
// Loading state
<Button isLoading loadingText="Submitting...">Submit</Button>

// Disabled state
<Button disabled>Cannot Submit</Button>
</example>
```

## Testing Rules

### 300-testing.mdc

```
---
description: "Testing standards and patterns for unit and integration tests"
globs: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"]
tags: ["testing", "jest", "rtl"]
priority: 3
---

# Testing Standards

@projectinfo.mdc

## Test File Organization

Test files should:
- Be co-located with the file they test
- Have a `.test.ts` or `.test.tsx` extension
- Follow the same naming convention as the file they test

<example language="typescript">
// For a component file: Button.tsx
// The test file should be: Button.test.tsx

// For a utility file: formatDate.ts
// The test file should be: formatDate.test.ts
</example>

## Unit Test Structure

Each unit test should follow the AAA pattern:
- **Arrange**: Set up the test data and conditions
- **Act**: Perform the action being tested
- **Assert**: Check that the result is as expected

<example language="typescript">
// Example unit test
describe('calculateTotal', () => {
  it('should correctly sum the prices of items', () => {
    // Arrange
    const items = [
      { name: 'Item 1', price: 10, quantity: 2 },
      { name: 'Item 2', price: 15, quantity: 1 },
    ];
    
    // Act
    const total = calculateTotal(items);
    
    // Assert
    expect(total).toBe(35); // 10*2 + 15*1
  });
});
</example>

## Component Testing

### Testing React Components

Use React Testing Library to test components:

<example language="typescript">
// Example component test
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('should render with the correct text', () => {
    // Arrange
    render(<Button>Click me</Button>);
    
    // Act - not needed for this test
    
    // Assert
    expect(screen.getByRole('button')).toHaveTextContent('Click me');
  });
  
  it('should call onClick when clicked', () => {
    // Arrange
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    
    // Act
    fireEvent.click(screen.getByRole('button'));
    
    // Assert
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
</example>

## Mocking

### API Mocking

Use jest.mock to mock API calls:

<example language="typescript">
// Example API mock
import { getUser } from './userApi';
import { User } from './types';

// Mock the userApi module
jest.mock('./userApi');

describe('User service', () => {
  it('should fetch user data', async () => {
    // Arrange
    const mockUser: User = { id: '123', name: 'Test User' };
    (getUser as jest.Mock).mockResolvedValue(mockUser);
    
    // Act
    const result = await userService.fetchUserData('123');
    
    // Assert
    expect(getUser).toHaveBeenCalledWith('123');
    expect(result).toEqual(mockUser);
  });
});
</example>
```

## API and Service Rules

### 400-api-services.mdc

```
---
description: "Standards for API services and data fetching"
globs: ["src/services/**/*.ts", "src/api/**/*.ts"]
tags: ["api", "services", "data-fetching"]
priority: 3
---

# API Service Standards

@projectinfo.mdc

## Service Structure

API services should be organized by domain and follow a consistent pattern:

<example language="typescript">
// src/services/userService.ts
import { apiClient } from '../utils/apiClient';
import { User, CreateUserParams, UpdateUserParams } from '../types';

export const userService = {
  // Get all users
  async getUsers(): Promise<User[]> {
    const response = await apiClient.get<User[]>('/users');
    return response.data;
  },
  
  // Get user by ID
  async getUserById(id: string): Promise<User> {
    const response = await apiClient.get<User>(`/users/${id}`);
    return response.data;
  },
  
  // Create new user
  async createUser(params: CreateUserParams): Promise<User> {
    const response = await apiClient.post<User>('/users', params);
    return response.data;
  },
  
  // Update existing user
  async updateUser(id: string, params: UpdateUserParams): Promise<User> {
    const response = await apiClient.put<User>(`/users/${id}`, params);
    return response.data;
  },
  
  // Delete user
  async deleteUser(id: string): Promise<void> {
    await apiClient.delete(`/users/${id}`);
  }
};
</example>

## Error Handling

All API services should implement proper error handling:

<example language="typescript">
// Error handling in services
async function fetchData() {
  try {
    const response = await apiClient.get('/data');
    return response.data;
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      throw new ApiError(
        error.response.status,
        error.response.data.message || 'An error occurred with the API request'
      );
    } else if (error.request) {
      // The request was made but no response was received
      throw new NetworkError('No response received from the server');
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new Error('Error setting up the request: ' + error.message);
    }
  }
}
</example>

## Request Caching

Use appropriate caching strategies for API requests:

<example language="typescript">
// Example using React Query for caching
export function useUserData(userId: string) {
  return useQuery(['user', userId], () => userService.getUserById(userId), {
    staleTime: 5 * 60 * 1000, // Data remains fresh for 5 minutes
    cacheTime: 30 * 60 * 1000, // Unused data is garbage collected after 30 minutes
    retry: 3, // Retry failed requests 3 times
    onError: (error) => {
      console.error('Failed to fetch user data:', error);
      // Additional error handling
    }
  });
}
</example>
```

## Documentation Rules

### 600-documentation.mdc

```
---
description: "Standards for code documentation and comments"
globs: ["**/*.ts", "**/*.tsx", "**/*.md"]
tags: ["documentation", "comments"]
priority: 2
---

# Documentation Standards

@projectinfo.mdc

## Code Comments

### Function and Method Documentation

Document functions and methods with JSDoc comments:

<example language="typescript">
/**
 * Calculates the total price of items in a cart.
 *
 * @param items - Array of cart items to calculate total from
 * @returns The total price of all items
 * @throws {Error} If any item has a negative price
 *
 * @example
 * const items = [{ name: 'Book', price: 10, quantity: 2 }];
 * const total = calculateTotal(items); // Returns 20
 */
function calculateTotal(items: CartItem[]): number {
  if (items.some(item => item.price < 0)) {
    throw new Error('Item prices cannot be negative');
  }
  
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
</example>

### Component Documentation

Document React components with JSDoc comments:

<example language="tsx">
/**
 * Button component for triggering actions.
 *
 * @component
 * @example
 * <Button variant="primary" onClick={handleClick}>
 *   Submit Form
 * </Button>
 */
export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary',
  onClick
}) => {
  // Component implementation
};
</example>

## Inline Comments

Use inline comments for complex logic that isn't immediately obvious:

<example language="typescript">
// Good: Explaining non-obvious logic
function normalizeData(data: RawData): NormalizedData {
  // Convert snake_case keys to camelCase
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  
  return result;
}

// Bad: Stating the obvious
function addNumbers(a: number, b: number): number {
  // Add a and b together
  return a + b;
}
</example>

## Markdown Documentation

### README Files

Each project and major directory should have a README.md file that includes:

1. **Overview**: What the project/module does
2. **Installation**: How to set up the project/module
3. **Usage**: How to use the project/module
4. **Examples**: Code examples showing common use cases
5. **API Reference**: Details of public API (for libraries)
6. **Contributing**: How to contribute (for open source)

<example language="markdown">
# User Authentication Module

## Overview

This module handles user authentication, including login, registration, password reset, and session management.

## Usage

```typescript
import { useAuth } from './auth';

// Inside your component
const { login, logout, currentUser } = useAuth();

// Login a user
await login(email, password);

// Logout the current user
logout();

// Get the current user
console.log(currentUser);
```

## API Reference

### `useAuth()`

React hook that provides authentication functionality.

Returns:
- `currentUser`: The currently authenticated user or null
- `login(email, password)`: Function to log in a user
- `logout()`: Function to log out the current user
- `register(userData)`: Function to register a new user
- `resetPassword(email)`: Function to initiate password reset
</example>
```

## Workflow Rules

### 800-git-workflow.mdc

```
---
description: "Git workflow and commit standards"
globs: [".git/**/*", "**/*.md"]
tags: ["git", "workflow", "commits"]
priority: 2
---

# Git Workflow Standards

## Branch Naming

Branches should follow the pattern:

```
<type>/<issue-number>-<short-description>
```

Where `<type>` is one of:
- `feature`: New features
- `bugfix`: Bug fixes
- `hotfix`: Critical fixes for production
- `chore`: Maintenance tasks
- `refactor`: Code refactoring
- `docs`: Documentation updates

Examples:
- `feature/123-user-authentication`
- `bugfix/456-fix-login-error`
- `refactor/789-optimize-performance`

## Commit Messages

Commit messages should follow the Conventional Commits format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Where `<type>` is one of:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (formatting, etc.)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

Examples:
- `feat(auth): add login functionality`
- `fix(api): handle error responses correctly`
- `docs(readme): update installation instructions`

## Pull Request Process

1. Create a branch from `develop` (or `main` depending on your workflow)
2. Make your changes in small, logical commits
3. Push your branch to the remote repository
4. Create a Pull Request with a clear description of the changes
5. Request reviews from appropriate team members
6. Address any feedback from code reviews
7. Once approved, merge the PR
8. Delete the branch after merging

## Code Review Guidelines

When reviewing code, focus on:

1. **Functionality**: Does the code work as intended?
2. **Code Quality**: Is the code well-structured and maintainable?
3. **Performance**: Are there any obvious performance issues?
4. **Security**: Are there any security vulnerabilities?
5. **Test Coverage**: Are there sufficient tests for the changes?
```

These examples cover a range of common rule types and demonstrate how to structure different kinds of Cursor rules. You can adapt these to your specific project needs and add more specialized rules as required. 