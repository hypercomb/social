import { Component } from '@angular/core';
import { HistoryComponent } from "../history-component/history";

@Component({
  selector: 'app-home',
  imports: [ HistoryComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {

}
