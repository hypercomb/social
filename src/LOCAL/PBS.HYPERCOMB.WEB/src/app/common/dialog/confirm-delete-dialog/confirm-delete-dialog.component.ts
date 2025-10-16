import { Component, inject, Inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';

@Component({
  selector: '[app-confirm-delete-dialog]',
  imports: [
    MatDialogModule,   // ✅ gives you mat-dialog-title, mat-dialog-content, mat-dialog-actions
    MatButtonModule,   // ✅ for <button mat-button> etc.
  ],
  templateUrl: './confirm-delete-dialog.component.html',
  styleUrl: './confirm-delete-dialog.component.scss'
})
export class ConfirmDeleteDialogComponent {
  private readonly snackBar = inject(MatSnackBar);
  public data = {
    title: 'Confirm Deletion',
    message: 'Are you sure you want to delete this item?',
    confirmText: 'Delete',
    cancelText: 'Cancel'
  }
  onCancel() {
  }

  onConfirm() {
    this.snackBar.open('Delete confirmed', 'Close', { duration: 2000 });
  }
}
