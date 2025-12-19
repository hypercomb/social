import { Routes } from '@angular/router';
import { SearchBarComponent } from './common/header/search-bar/search-bar.component';

export const routes: Routes = [
    {
        path: '**',
        component: SearchBarComponent
    }
];
