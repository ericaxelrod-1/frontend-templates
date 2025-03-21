import { Injectable } from '@angular/core';
import { Action, Selector, State, StateContext } from '@ngxs/store';
import { TasksState as TasksStateModel } from '../../models/tasks.model';
import { TasksActions } from './tasks.actions';
import { catchError, tap } from 'rxjs/operators';
import { TaskService } from '../../core/services/task.service';

@State<TasksStateModel>({
  name: 'tasks',
  defaults: {
    tasks: [],
    selectedTask: null,
    loading: false,
    error: null
  }
})
@Injectable()
export class TasksState {
  constructor(private taskService: TaskService) {}

  @Selector()
  static tasks(state: TasksStateModel) {
    return state.tasks;
  }

  @Selector()
  static selectedTask(state: TasksStateModel) {
    return state.selectedTask;
  }

  @Selector()
  static loading(state: TasksStateModel) {
    return state.loading;
  }

  @Selector()
  static error(state: TasksStateModel) {
    return state.error;
  }

  @Action(TasksActions.LoadTasks)
  loadTasks(ctx: StateContext<TasksStateModel>, action: TasksActions.LoadTasks) {
    ctx.patchState({ loading: true });
    
    return this.taskService.getTasks(action.payload).pipe(
      tap((tasks) => {
        ctx.patchState({
          tasks,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to load tasks'
        });
        throw error;
      })
    );
  }

  @Action(TasksActions.LoadTask)
  loadTask(ctx: StateContext<TasksStateModel>, action: TasksActions.LoadTask) {
    ctx.patchState({ loading: true });
    
    return this.taskService.getTask(action.id).pipe(
      tap((task) => {
        ctx.patchState({
          selectedTask: task,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to load task'
        });
        throw error;
      })
    );
  }

  @Action(TasksActions.CreateTask)
  createTask(ctx: StateContext<TasksStateModel>, action: TasksActions.CreateTask) {
    ctx.patchState({ loading: true });
    
    return this.taskService.createTask(action.payload).pipe(
      tap((task) => {
        const state = ctx.getState();
        ctx.patchState({
          tasks: [...state.tasks, task],
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to create task'
        });
        throw error;
      })
    );
  }

  @Action(TasksActions.UpdateTask)
  updateTask(ctx: StateContext<TasksStateModel>, action: TasksActions.UpdateTask) {
    ctx.patchState({ loading: true });
    
    return this.taskService.updateTask(action.payload).pipe(
      tap((updatedTask) => {
        const state = ctx.getState();
        const tasks = state.tasks.map(task => 
          task.id === updatedTask.id ? updatedTask : task
        );
        
        ctx.patchState({
          tasks,
          selectedTask: state.selectedTask?.id === updatedTask.id ? updatedTask : state.selectedTask,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to update task'
        });
        throw error;
      })
    );
  }

  @Action(TasksActions.DeleteTask)
  deleteTask(ctx: StateContext<TasksStateModel>, action: TasksActions.DeleteTask) {
    ctx.patchState({ loading: true });
    
    return this.taskService.deleteTask(action.id).pipe(
      tap(() => {
        const state = ctx.getState();
        ctx.patchState({
          tasks: state.tasks.filter(task => task.id !== action.id),
          selectedTask: state.selectedTask?.id === action.id ? null : state.selectedTask,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to delete task'
        });
        throw error;
      })
    );
  }

  @Action(TasksActions.SetSelectedTask)
  setSelectedTask(ctx: StateContext<TasksStateModel>, action: TasksActions.SetSelectedTask) {
    ctx.patchState({ selectedTask: action.payload });
  }
} 