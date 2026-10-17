/** Keep list markup and click handlers while providing native keyboard activation. */
export function addListAction(item: HTMLLIElement): void {
    const button: HTMLButtonElement = document.createElement('button');
    button.type = 'button';
    button.className = 'lore-list-action';
    button.append(...Array.from(item.childNodes));
    item.append(button);
}
