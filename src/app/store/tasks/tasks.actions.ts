import { Task } from '../../models/task.model';
import { TaskCreateRequest, TasksFilter, TaskUpdateRequest } from '../../models/tasks.model';

export namespace TasksActions {
  export class LoadTasks {
    static readonly type = '[Tasks] Load Tasks';
    constructor(public payload?: TasksFilter) {}
  }

  export class LoadTask {
    static readonly type = '[Tasks] Load Task';
    constructor(public id: number) {}
  }

  export class CreateTask {
    static readonly type = '[Tasks] Create Task';
    constructor(public payload: TaskCreateRequest) {}
  }

  export class UpdateTask {
    static readonly type = '[Tasks] Update Task';
    constructor(public payload: TaskUpdateRequest) {}
  }

  export class DeleteTask {
    static readonly type = '[Tasks] Delete Task';
    constructor(public id: number) {}
  }

  export class SetSelectedTask {
    static readonly type = '[Tasks] Set Selected Task';
    constructor(public payload: Task | null) {}
  }
} 