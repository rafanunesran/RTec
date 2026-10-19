export class DuplicateError extends Error {
  constructor(field) {
    super(`Valor duplicado em ${field}`);
    this.field = field;
  }
}

export const now = () => new Date().toISOString();
