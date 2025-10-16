export interface IDropDispatcher {
    dispatch(event: DragEvent): Promise<boolean>
}

