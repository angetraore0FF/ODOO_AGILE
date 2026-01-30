# Module Custom BPM - Gestion de Processus Métiers avec Éditeur Graphique

## Description

Ce module Odoo permet de créer et gérer des processus métiers (BPM - Business Process Management) dynamiques avec un éditeur graphique de workflow intégré.

## Fonctionnalités

### 1. Création de Processus
- Définition de processus métiers personnalisés
- Association à n'importe quel modèle Odoo
- Gestion de versions
- Éditeur graphique de workflow (glisser-déposer)

### 2. Types de Nœuds
- **Début (Start)** : Point d'entrée du processus
- **Tâche (Task)** : Étape de traitement
- **Passerelle (Gateway)** : Point de décision avec conditions
- **Fin (End)** : Point de sortie du processus

### 3. Transitions
- Liens entre les nœuds
- Conditions Python pour déterminer le chemin
- Évaluation dynamique basée sur les données de l'enregistrement

### 4. Exécution
- Moteur d'exécution automatique
- Suivi en temps réel des instances
- Historique des étapes parcourues
- Barre de progression visuelle

### 5. Intégration
- Mixin `bpm.mixin` pour ajouter les fonctionnalités BPM à vos modèles
- Bouton "Lancer le processus" sur les enregistrements
- Vue des instances actives

## Installation

1. Copiez le module dans votre répertoire `addons`
2. Mettez à jour la liste des applications dans Odoo
3. Installez le module "Gestion BPM avec Éditeur Graphique"

## Utilisation

### Créer un Processus

1. Allez dans **BPM > Processus**
2. Créez un nouveau processus
3. Sélectionnez le modèle Odoo cible
4. Cliquez sur l'onglet "Éditeur de Workflow"
5. Utilisez les boutons pour ajouter des nœuds :
   - **Ajouter Début** : Point de départ
   - **Ajouter Tâche** : Étape de traitement
   - **Ajouter Décision** : Point de branchement
   - **Ajouter Fin** : Point d'arrivée
6. Cliquez sur un nœud puis sur "Connecter" pour créer des transitions
7. Cliquez sur une transition pour définir sa condition

### Lancer un Processus

#### Option 1 : Depuis un modèle avec le mixin BPM

Si votre modèle hérite de `bpm.mixin` :

```python
class YourModel(models.Model):
    _name = 'your.model'
    _inherit = ['bpm.mixin']
```

Un bouton "Lancer le processus" apparaîtra automatiquement dans la vue formulaire.

#### Option 2 : Depuis le menu BPM

1. Allez dans **BPM > Instances**
2. Créez une nouvelle instance
3. Sélectionnez le processus et l'enregistrement cible
4. Cliquez sur "Démarrer"

### Exécuter une Instance

1. Ouvrez l'instance depuis **BPM > Instances**
2. Cliquez sur "Démarrer" pour lancer le processus
3. Utilisez "Étape suivante" pour avancer manuellement
4. Le processus se termine automatiquement lorsqu'il atteint un nœud de fin

## Architecture Technique

### Modèles

- **bpm.process** : Conteneur du processus
- **bpm.node** : Nœud (étape) du processus
- **bpm.edge** : Transition entre deux nœuds
- **bpm.instance** : Instance d'exécution d'un processus

### Moteur d'Exécution

Le moteur d'exécution (`action_next_step()`) :
1. Analyse le nœud actuel
2. Évalue les conditions des transitions sortantes
3. Sélectionne la première transition valide
4. Déplace l'instance vers le nœud suivant
5. Exécute le code Python du nœud (si présent)
6. Termine automatiquement si le nœud est de type "end"

### Éditeur Graphique

L'éditeur utilise :
- **SVG** pour le rendu graphique
- **OWL 2** (Odoo Web Library) pour le composant
- **JavaScript** pour l'interaction utilisateur

## Exemples de Conditions

### Condition simple

```python
record.state == 'draft'
```

### Condition avec comparaison numérique

```python
record.amount > 1000
```

### Condition avec date

```python
record.date_deadline < datetime.datetime.now()
```

### Condition complexe

```python
record.state == 'approved' and record.amount > 5000
```

## Code d'Action sur un Nœud

Vous pouvez exécuter du code Python lorsqu'un nœud est atteint :

```python
# Exemple : Envoyer un email
record.message_post(
    body='Le processus a atteint l\'étape : Validation',
    subject='Notification BPM'
)

# Exemple : Modifier un champ
record.write({'state': 'in_progress'})
```

Variables disponibles :
- `record` : L'enregistrement du modèle cible
- `instance` : L'instance BPM actuelle
- `node` : Le nœud actuel
- `env` : L'environnement Odoo
- `datetime` : Module datetime Python
- `dateutil` : Module dateutil Python

## Sécurité

Les droits d'accès sont définis dans `security/ir.model.access.csv` :
- **Gestionnaires système** : Accès complet (CRUD)
- **Utilisateurs** : Lecture seule sur les processus, création/lecture sur les instances

## Développement

### Ajouter le mixin à un modèle existant

```python
class SaleOrder(models.Model):
    _name = 'sale.order'
    _inherit = ['sale.order', 'bpm.mixin']
```

### Créer un processus programmatiquement

```python
process = self.env['bpm.process'].create({
    'name': 'Processus de validation',
    'model_id': self.env.ref('base.model_sale_order').id,
    'version': '1.0',
})

# Créer des nœuds
start_node = self.env['bpm.node'].create({
    'name': 'Début',
    'process_id': process.id,
    'node_type': 'start',
    'position_x': 100,
    'position_y': 100,
})

# Créer des transitions
edge = self.env['bpm.edge'].create({
    'name': 'Validation',
    'process_id': process.id,
    'source_node_id': start_node.id,
    'target_node_id': end_node.id,
    'condition': 'record.state == "draft"',
})
```

## Support

Pour toute question ou problème, veuillez consulter la documentation Odoo ou contacter le support.

## Licence

LGPL-3

