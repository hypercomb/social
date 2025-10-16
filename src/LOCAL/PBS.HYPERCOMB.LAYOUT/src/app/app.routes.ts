import { Routes } from '@angular/router';
import { Home } from './home/home';
import { HistoryComponent } from './history-component/history';

export const routes: Routes = [
    {
        path: '**',
        component: HistoryComponent
    }
];