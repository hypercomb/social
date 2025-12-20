import { Routes } from '@angular/router';
import { SearchBarComponent } from './common/header/search-bar/search-bar.component';
import { Home } from './home/home';

export const routes: Routes = [
    {
        path: '**',
        component: Home
    }
];
