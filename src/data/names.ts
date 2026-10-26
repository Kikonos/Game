// Crew name kit per nationality, and the crew mix hired at each home base.
// First names are [female, male] lists so generated crews are mixed.
// namesWorld.ts adds a kit for every other country a client can come from (the phone call's caller).

import { CALLER_KITS, WORLD_NAMES } from './namesWorld';

export interface NameKit {
  f: string[];
  m: string[];
  last: string[];
  /** Feminine surname forms, index-aligned with `last` (Baltic, Slavic). */
  lastF?: string[];
  /** Working languages beyond English. */
  langs: string[];
  /** Said family name first ('Nguyễn Lan', 'Kim Ji-woo'). */
  familyFirst?: boolean;
}

const CREW_NAMES: Record<string, NameKit> = {
  PT: {
    f: ['Ana', 'Beatriz', 'Catarina', 'Inês', 'Joana', 'Mariana', 'Rita', 'Sofia', 'Teresa', 'Leonor', 'Carolina', 'Marta'],
    m: ['António', 'Bruno', 'Diogo', 'Duarte', 'Francisco', 'João', 'Miguel', 'Nuno', 'Pedro', 'Rui', 'Tiago', 'Vasco'],
    last: ['Almeida', 'Carvalho', 'Costa', 'Ferreira', 'Gomes', 'Lopes', 'Marques', 'Martins', 'Mendes', 'Oliveira', 'Pereira', 'Ribeiro', 'Rodrigues', 'Santos', 'Silva', 'Sousa', 'Teixeira', 'Vieira'],
    langs: ['pt', 'es'],
  },
  BR: {
    f: ['Camila', 'Fernanda', 'Gabriela', 'Juliana', 'Larissa', 'Luana', 'Patrícia', 'Renata'],
    m: ['Caio', 'Felipe', 'Gustavo', 'Henrique', 'Lucas', 'Mateus', 'Rafael', 'Thiago'],
    last: ['Barbosa', 'Cardoso', 'Castro', 'Moreira', 'Nascimento', 'Pinto', 'Rocha', 'Souza'],
    langs: ['pt'],
  },
  ES: {
    f: ['Alba', 'Carmen', 'Elena', 'Irene', 'Lucía', 'María', 'Nerea', 'Paula', 'Raquel', 'Sara'],
    m: ['Álvaro', 'Carlos', 'David', 'Javier', 'Jorge', 'Manuel', 'Pablo', 'Sergio', 'Daniel', 'Iker'],
    last: ['Díaz', 'Fernández', 'García', 'González', 'Hernández', 'López', 'Martín', 'Moreno', 'Navarro', 'Pérez', 'Ruiz', 'Sánchez', 'Torres', 'Vidal'],
    langs: ['es'],
  },
  LT: {
    f: ['Agnė', 'Eglė', 'Gabija', 'Ieva', 'Indrė', 'Justė', 'Rūta', 'Simona', 'Vaida', 'Laura'],
    m: ['Andrius', 'Darius', 'Domantas', 'Jonas', 'Karolis', 'Lukas', 'Mantas', 'Paulius', 'Tomas', 'Vytautas'],
    last: ['Bielskis', 'Jankauskas', 'Kazlauskas', 'Petrauskas', 'Stankevičius', 'Vasiliauskas', 'Žukauskas', 'Butkus', 'Paulauskas', 'Urbonas'],
    lastF: ['Bielskytė', 'Jankauskaitė', 'Kazlauskaitė', 'Petrauskaitė', 'Stankevičiūtė', 'Vasiliauskaitė', 'Žukauskaitė', 'Butkutė', 'Paulauskaitė', 'Urbonaitė'],
    langs: ['lt', 'ru'],
  },
  LV: {
    f: ['Anna', 'Elīna', 'Ilze', 'Kristīne', 'Laura', 'Līga', 'Sanita', 'Zane'],
    m: ['Artūrs', 'Edgars', 'Jānis', 'Kārlis', 'Mārtiņš', 'Raivis', 'Roberts', 'Valdis'],
    last: ['Bērziņš', 'Kalniņš', 'Ozoliņš', 'Krūmiņš', 'Liepa', 'Ozols', 'Vītols', 'Zariņš'],
    lastF: ['Bērziņa', 'Kalniņa', 'Ozoliņa', 'Krūmiņa', 'Liepa', 'Ozola', 'Vītola', 'Zariņa'],
    langs: ['lv', 'ru'],
  },
  MT: {
    f: ['Claire', 'Elaine', 'Maria', 'Rachel', 'Roberta', 'Stephanie', 'Yanica', 'Nicole'],
    m: ['Clayton', 'Daniel', 'Joseph', 'Kurt', 'Luke', 'Matthew', 'Neil', 'Ryan'],
    last: ['Abela', 'Azzopardi', 'Borg', 'Camilleri', 'Caruana', 'Farrugia', 'Galea', 'Grech', 'Vella', 'Zammit'],
    langs: ['mt', 'it'],
  },
  IT: {
    f: ['Chiara', 'Francesca', 'Giulia', 'Martina', 'Sara', 'Valentina'],
    m: ['Alessandro', 'Davide', 'Luca', 'Marco', 'Matteo', 'Stefano'],
    last: ['Bianchi', 'Colombo', 'Esposito', 'Ferrari', 'Ricci', 'Romano', 'Rossi', 'Russo'],
    langs: ['it'],
  },
  RO: {
    f: ['Andreea', 'Elena', 'Ioana', 'Maria', 'Raluca', 'Simona'],
    m: ['Adrian', 'Andrei', 'Bogdan', 'Cristian', 'Mihai', 'Radu'],
    last: ['Constantin', 'Dumitru', 'Ionescu', 'Popa', 'Popescu', 'Stan', 'Stoica'],
    langs: ['ro'],
  },
  PL: {
    f: ['Agnieszka', 'Joanna', 'Katarzyna', 'Magdalena', 'Natalia', 'Zofia'],
    m: ['Jakub', 'Kamil', 'Marcin', 'Michał', 'Piotr', 'Tomasz'],
    last: ['Kowalczyk', 'Kowalski', 'Lewandowski', 'Nowak', 'Wiśniewski', 'Wójcik', 'Zieliński'],
    lastF: ['Kowalczyk', 'Kowalska', 'Lewandowska', 'Nowak', 'Wiśniewska', 'Wójcik', 'Zielińska'],
    langs: ['pl'],
  },
  GB: {
    f: ['Charlotte', 'Emily', 'Hannah', 'Lucy', 'Olivia', 'Sophie'],
    m: ['Ben', 'Callum', 'George', 'James', 'Oliver', 'Tom'],
    last: ['Clarke', 'Evans', 'Hughes', 'Jones', 'Smith', 'Taylor', 'Walker', 'Wright'],
    langs: [],
  },
  FR: {
    f: ['Camille', 'Chloé', 'Léa', 'Manon', 'Inès', 'Sarah'],
    m: ['Antoine', 'Hugo', 'Julien', 'Louis', 'Mathieu', 'Nicolas'],
    last: ['Bernard', 'Dubois', 'Durand', 'Lefebvre', 'Martin', 'Moreau', 'Petit', 'Richard'],
    langs: ['fr'],
  },
  CZ: {
    f: ['Tereza', 'Kateřina', 'Lucie', 'Veronika', 'Petra', 'Barbora', 'Markéta', 'Klára'],
    m: ['Jakub', 'Jan', 'Tomáš', 'Martin', 'Ondřej', 'Lukáš', 'Petr', 'Vojtěch'],
    last: ['Novák', 'Svoboda', 'Novotný', 'Dvořák', 'Černý', 'Procházka', 'Kučera', 'Veselý', 'Horák', 'Němec'],
    lastF: ['Nováková', 'Svobodová', 'Novotná', 'Dvořáková', 'Černá', 'Procházková', 'Kučerová', 'Veselá', 'Horáková', 'Němcová'],
    langs: ['cs', 'sk'],
  },
  SK: {
    f: ['Zuzana', 'Jana', 'Simona', 'Lenka', 'Michaela', 'Dominika'],
    m: ['Marek', 'Peter', 'Michal', 'Juraj', 'Matej', 'Martin'],
    last: ['Horváth', 'Kováč', 'Varga', 'Tóth', 'Nagy', 'Baláž'],
    lastF: ['Horváthová', 'Kováčová', 'Vargová', 'Tóthová', 'Nagyová', 'Balážová'],
    langs: ['sk', 'cs'],
  },
  BG: {
    f: ['Maria', 'Ivana', 'Elena', 'Desislava', 'Gergana', 'Viktoria', 'Teodora', 'Nikol'],
    m: ['Georgi', 'Ivan', 'Dimitar', 'Nikolay', 'Hristo', 'Stoyan', 'Martin', 'Petar'],
    last: ['Ivanov', 'Georgiev', 'Dimitrov', 'Petrov', 'Nikolov', 'Hristov', 'Stoyanov', 'Todorov', 'Iliev', 'Angelov'],
    lastF: ['Ivanova', 'Georgieva', 'Dimitrova', 'Petrova', 'Nikolova', 'Hristova', 'Stoyanova', 'Todorova', 'Ilieva', 'Angelova'],
    langs: ['bg', 'ru'],
  },
  EE: {
    f: ['Kadri', 'Liis', 'Maarja', 'Kristiina', 'Triin', 'Kertu', 'Getter', 'Anu'],
    m: ['Martin', 'Rasmus', 'Andres', 'Siim', 'Kristjan', 'Mart', 'Tanel', 'Priit'],
    last: ['Tamm', 'Saar', 'Sepp', 'Mägi', 'Kask', 'Kukk', 'Rebane', 'Ilves', 'Pärn', 'Koppel'],
    langs: ['et', 'ru', 'fi'],
  },
  CV: {
    f: ['Djamila', 'Elisa', 'Ilda', 'Nádia'],
    m: ['Amílcar', 'Hélder', 'Nelson', 'Válter'],
    last: ['Fortes', 'Lima', 'Monteiro', 'Semedo', 'Tavares', 'Varela'],
    langs: ['pt', 'fr'],
  },
};

/** Every name kit: the crew kits first (PT stays the first one), then the world's. */
export const NAMES: Record<string, NameKit> = { ...CREW_NAMES, ...WORLD_NAMES };

/** The kits a country's people are named from (Belgium: Dutch and French…); [] when the country has none. */
export function kitsFor(country: string): string[] {
  return CALLER_KITS[country] ?? (NAMES[country] ? [country] : []);
}

/** Nationality weights for crew hired at a home base (by base country). */
export const CREW_MIX: Record<string, [string, number][]> = {
  PT: [['PT', 0.72], ['BR', 0.1], ['ES', 0.08], ['CV', 0.05], ['FR', 0.05]],
  ES: [['ES', 0.75], ['PT', 0.08], ['IT', 0.07], ['FR', 0.05], ['RO', 0.05]],
  LT: [['LT', 0.6], ['LV', 0.12], ['PL', 0.12], ['GB', 0.06], ['ES', 0.05], ['IT', 0.05]],
  LV: [['LV', 0.6], ['LT', 0.15], ['PL', 0.1], ['RO', 0.05], ['GB', 0.05], ['IT', 0.05]],
  CZ: [['CZ', 0.7], ['SK', 0.15], ['PL', 0.08], ['GB', 0.04], ['IT', 0.03]],
  BG: [['BG', 0.8], ['RO', 0.08], ['GB', 0.04], ['IT', 0.04], ['PL', 0.04]],
  EE: [['EE', 0.65], ['LV', 0.12], ['LT', 0.08], ['PL', 0.05], ['GB', 0.05], ['IT', 0.05]],
  MT: [['MT', 0.4], ['IT', 0.15], ['GB', 0.12], ['RO', 0.1], ['PL', 0.08], ['ES', 0.08], ['PT', 0.07]],
};

export const DEFAULT_MIX: [string, number][] = [['GB', 0.3], ['ES', 0.2], ['PT', 0.2], ['IT', 0.15], ['PL', 0.15]];
